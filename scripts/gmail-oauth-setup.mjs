#!/usr/bin/env node

/**
 * Gmail OAuth Setup Script
 * One-time setup to get a refresh token for Gmail API access.
 *
 * Prerequisites:
 *   1. Create a Google Cloud project
 *   2. Enable Gmail API
 *   3. Create OAuth 2.0 credentials (Desktop app)
 *   4. Set GMAIL_CLIENT_ID and GMAIL_CLIENT_SECRET in .env
 *
 * Usage:
 *   node scripts/gmail-oauth-setup.mjs
 */

import http from 'http';
import { URL } from 'url';
import dotenv from 'dotenv';

dotenv.config();

const CLIENT_ID = process.env.GMAIL_CLIENT_ID;
const CLIENT_SECRET = process.env.GMAIL_CLIENT_SECRET;
const REDIRECT_URI = 'http://localhost:3333/oauth2callback';
const SCOPE = 'https://www.googleapis.com/auth/gmail.readonly';
const PORT = 3333;

if (!CLIENT_ID || !CLIENT_SECRET) {
  console.error('Missing GMAIL_CLIENT_ID or GMAIL_CLIENT_SECRET in .env');
  console.error('Set these first, then re-run this script.');
  process.exit(1);
}

// Build consent URL
const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
authUrl.searchParams.set('client_id', CLIENT_ID);
authUrl.searchParams.set('redirect_uri', REDIRECT_URI);
authUrl.searchParams.set('response_type', 'code');
authUrl.searchParams.set('scope', SCOPE);
authUrl.searchParams.set('access_type', 'offline');
authUrl.searchParams.set('prompt', 'consent');

console.log('\n=== Gmail OAuth Setup ===\n');
console.log('Open this URL in your browser:\n');
console.log(authUrl.toString());
console.log('\nWaiting for OAuth callback on port', PORT, '...\n');

// Start local server to receive the callback
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  if (url.pathname !== '/oauth2callback') {
    res.writeHead(404);
    res.end('Not found');
    return;
  }

  const code = url.searchParams.get('code');
  const error = url.searchParams.get('error');

  if (error) {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<h1>Error</h1><p>${error}</p>`);
    console.error('OAuth error:', error);
    server.close();
    process.exit(1);
  }

  if (!code) {
    res.writeHead(400, { 'Content-Type': 'text/html' });
    res.end('<h1>No code received</h1>');
    return;
  }

  // Exchange code for tokens
  try {
    const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        redirect_uri: REDIRECT_URI,
        grant_type: 'authorization_code',
      }),
    });

    const tokens = await tokenResponse.json();

    if (tokens.error) {
      throw new Error(`${tokens.error}: ${tokens.error_description}`);
    }

    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end('<h1>Success!</h1><p>You can close this window. Check the terminal for your tokens.</p>');

    console.log('=== OAuth Tokens ===\n');
    console.log('Add this to your .env file:\n');
    console.log(`GMAIL_REFRESH_TOKEN=${tokens.refresh_token}`);
    console.log('\n(Access token is temporary and not needed in .env)\n');

    if (tokens.access_token) {
      console.log('Testing token with Gmail API...');
      const testResponse = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/profile', {
        headers: { Authorization: `Bearer ${tokens.access_token}` },
      });
      const profile = await testResponse.json();
      console.log('Authenticated as:', profile.emailAddress);
      console.log('Total messages:', profile.messagesTotal);
    }

    console.log('\nDone! Add the GMAIL_REFRESH_TOKEN to your .env and restart the agent.');
  } catch (err) {
    res.writeHead(500, { 'Content-Type': 'text/html' });
    res.end(`<h1>Token exchange failed</h1><p>${err.message}</p>`);
    console.error('Token exchange failed:', err.message);
  }

  server.close();
  process.exit(0);
});

server.listen(PORT);
