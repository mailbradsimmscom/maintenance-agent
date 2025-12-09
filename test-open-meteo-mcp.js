#!/usr/bin/env node
/**
 * Test script to explore Open-Meteo MCP server
 * 
 * This script helps us understand:
 * 1. How to connect to the MCP server
 * 2. What tools are available
 * 3. What data format it returns
 * 4. If it supports marine weather for Caribbean
 */

import { spawn } from 'child_process';
import { createLogger } from './src/utils/logger.js';

// Simple test - just check the API directly first

const logger = createLogger('test-open-meteo-mcp');

/**
 * Option 1: Run MCP server via npx and connect via stdio
 */
async function testViaNpx() {
  logger.info('Testing Open-Meteo MCP server via npx...');
  
  // The MCP server runs as a subprocess
  // We communicate via stdio (stdin/stdout)
  
  const mcpProcess = spawn('npx', ['-y', 'open-meteo-mcp'], {
    stdio: ['pipe', 'pipe', 'pipe']
  });

  // MCP uses JSON-RPC protocol over stdio
  // Send initialize request
  const initRequest = {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: '2024-11-05',
      capabilities: {},
      clientInfo: {
        name: 'maintenance-agent',
        version: '1.0.0'
      }
    }
  };

  mcpProcess.stdin.write(JSON.stringify(initRequest) + '\n');

  mcpProcess.stdout.on('data', (data) => {
    const response = JSON.parse(data.toString());
    logger.info('MCP Response:', response);
  });

  mcpProcess.stderr.on('data', (data) => {
    logger.error('MCP Error:', data.toString());
  });

  mcpProcess.on('close', (code) => {
    logger.info(`MCP process exited with code ${code}`);
  });
}

/**
 * Option 2: Check if we can use the Open-Meteo API directly
 * (Simpler approach - no MCP needed)
 */
async function testDirectAPI() {
  logger.info('Testing Open-Meteo API directly...');
  
  // Open-Meteo has a free API that doesn't require auth
  // Let's test marine weather for Caribbean (Bequia area)
  const lat = 12.5;  // Bequia
  const lon = -61.2;
  
  const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&hourly=wave_height,wave_direction,wave_period,wind_wave_height,wind_wave_direction,wind_wave_period,swell_wave_height,swell_wave_direction,swell_wave_period&models=ecmwf,gfs`;
  
  try {
    const response = await fetch(url);
    const data = await response.json();
    
    logger.info('Open-Meteo Marine API Response:', {
      hasData: !!data.hourly,
      timePoints: data.hourly?.time?.length || 0,
      models: data.models || [],
      units: data.hourly_units || {}
    });
    
    // Show sample data
    if (data.hourly && data.hourly.time) {
      logger.info('Sample forecast:', {
        time: data.hourly.time[0],
        waveHeight: data.hourly.wave_height?.[0],
        waveDirection: data.hourly.wave_direction?.[0],
        windWaveHeight: data.hourly.wind_wave_height?.[0],
        swellWaveHeight: data.hourly.swell_wave_height?.[0]
      });
    }
    
    return data;
  } catch (error) {
    logger.error('Failed to fetch from Open-Meteo API:', error);
    throw error;
  }
}

/**
 * Main test function
 */
async function main() {
  logger.info('=== Open-Meteo MCP Server Exploration ===');
  logger.info('');
  
  // First, test the direct API (simpler)
  logger.info('1. Testing Open-Meteo API directly (no MCP)...');
  try {
    await testDirectAPI();
    logger.info('✅ Direct API works!');
  } catch (error) {
    logger.error('❌ Direct API failed:', error.message);
  }
  
  logger.info('');
  logger.info('2. Testing MCP server connection...');
  logger.info('   (This requires @modelcontextprotocol/sdk)');
  logger.info('   Run: npm install @modelcontextprotocol/sdk');
  
  // Note: MCP client requires the SDK
  // We'll need to install it first
}

main().catch(error => {
  logger.error('Test failed:', error);
  process.exit(1);
});
