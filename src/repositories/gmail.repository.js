/**
 * Gmail Repository
 * Gmail API access via native fetch (no googleapis package).
 * Handles OAuth token refresh, message search, and text extraction.
 */

import { getConfig } from '../config/env.js';
import { createLogger } from '../utils/logger.js';

const config = getConfig();
const logger = createLogger('gmail-repository');

const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1/users/me';
const TOKEN_URL = 'https://oauth2.googleapis.com/token';

let cachedAccessToken = null;
let tokenExpiresAt = 0;

export const gmailRepository = {
  /**
   * Get a valid access token, refreshing if needed
   */
  async getAccessToken() {
    if (cachedAccessToken && Date.now() < tokenExpiresAt - 60000) {
      return cachedAccessToken;
    }

    const { clientId, clientSecret, refreshToken } = config.gmail;
    if (!clientId || !clientSecret || !refreshToken) {
      throw new Error('Gmail credentials not configured. Set GMAIL_CLIENT_ID, GMAIL_CLIENT_SECRET, and GMAIL_REFRESH_TOKEN.');
    }

    const response = await fetch(TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: 'refresh_token',
      }),
    });

    const data = await response.json();

    if (data.error) {
      logger.error('Gmail token refresh failed', { error: data.error, description: data.error_description });
      throw new Error(`Gmail token invalid — re-run OAuth setup and update GMAIL_REFRESH_TOKEN. Error: ${data.error}`);
    }

    cachedAccessToken = data.access_token;
    tokenExpiresAt = Date.now() + (data.expires_in * 1000);
    logger.info('Gmail access token refreshed');
    return cachedAccessToken;
  },

  /**
   * Search Gmail messages
   * @param {string} query - Gmail search query (e.g. "from:support@mwxc.com newer_than:2d")
   * @returns {Array} Array of { id, threadId }
   */
  async searchMessages(query) {
    const token = await this.getAccessToken();
    const url = new URL(`${GMAIL_API_BASE}/messages`);
    url.searchParams.set('q', query);
    url.searchParams.set('maxResults', '20');

    const response = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      const error = await response.text();
      logger.error('Gmail search failed', { status: response.status, error });
      throw new Error(`Gmail search failed: ${response.status}`);
    }

    const data = await response.json();
    return data.messages || [];
  },

  /**
   * Get a single message by ID
   * @param {string} messageId - Gmail message ID
   * @returns {Object} Full message object
   */
  async getMessage(messageId) {
    const token = await this.getAccessToken();
    const url = `${GMAIL_API_BASE}/messages/${messageId}?format=full`;

    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
    });

    if (!response.ok) {
      throw new Error(`Gmail getMessage failed: ${response.status}`);
    }

    return response.json();
  },

  /**
   * Extract plain text from a Gmail message
   * Handles multipart MIME and base64url encoding
   */
  extractPlainText(message) {
    const payload = message.payload;

    // Simple text/plain body
    if (payload.mimeType === 'text/plain' && payload.body?.data) {
      return this._decodeBase64Url(payload.body.data);
    }

    // Multipart - find text/plain part
    if (payload.parts) {
      const textPart = this._findTextPart(payload.parts);
      if (textPart?.body?.data) {
        return this._decodeBase64Url(textPart.body.data);
      }
    }

    logger.warn('Could not extract plain text from message', { id: message.id });
    return '';
  },

  /**
   * Extract headers from a message
   */
  extractHeaders(message) {
    const headers = message.payload?.headers || [];
    const get = (name) => headers.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
    return {
      subject: get('Subject'),
      from: get('From'),
      date: get('Date'),
    };
  },

  _findTextPart(parts) {
    for (const part of parts) {
      if (part.mimeType === 'text/plain' && part.body?.data) {
        return part;
      }
      if (part.parts) {
        const found = this._findTextPart(part.parts);
        if (found) return found;
      }
    }
    return null;
  },

  _decodeBase64Url(encoded) {
    const base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
    return Buffer.from(base64, 'base64').toString('utf-8');
  },
};

export default gmailRepository;
