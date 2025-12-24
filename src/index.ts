#!/usr/bin/env node
// ============================================================================
// PRD Gauntlet MCP Server - Entry Point
// ============================================================================

import { config as dotenvConfig } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

// Load .env from the package directory (not cwd)
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const envPath = resolve(__dirname, '..', '.env');
dotenvConfig({ path: envPath, quiet: true });
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';
import { loadConfig } from './utils/config.js';
import { validateAllModels } from './clients/validator.js';
import { jobStore } from './utils/jobStore.js';
import { logger } from './utils/logger.js';

async function main(): Promise<void> {
  try {
    // Load configuration
    logger.logInfo('Loading configuration...');
    const config = loadConfig();

    // Set debug mode
    logger.setDebug(config.debug);

    // Configure job store
    jobStore.setMaxConcurrentJobs(config.maxConcurrentJobs);

    // Validate models on startup
    logger.logInfo('Validating models...');
    await validateAllModels(config);

    // Create server
    const server = createServer(config);

    // Connect via stdio transport
    logger.logInfo('Starting MCP server via stdio...');
    const transport = new StdioServerTransport();
    await server.connect(transport);

    logger.logInfo('PRD Gauntlet MCP server running');
  } catch (error) {
    logger.logError('Failed to start server', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    process.exit(1);
  }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
  logger.logInfo('Received SIGINT, shutting down...');
  process.exit(0);
});

process.on('SIGTERM', () => {
  logger.logInfo('Received SIGTERM, shutting down...');
  process.exit(0);
});

main();
