// ============================================================================
// MCP Server Setup - Tool registration
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GauntletConfig } from './types/index.js';
import { handleRunGauntlet } from './tools/runGauntlet.js';
import { handleHealth } from './tools/health.js';
import { logger } from './utils/logger.js';

// Define Zod schemas for MCP tool registration
const RunGauntletParamsSchema = {
  prd: z.string().describe('The PRD markdown content to refine'),
  metadata: z
    .object({
      title: z.string().optional().describe('PRD title'),
      productContext: z.string().optional().describe('Background info for critics'),
      constraints: z.array(z.string()).optional().describe('Known constraints to respect'),
    })
    .optional()
    .describe('Optional metadata for context'),
  config: z
    .object({
      maxRoundsPerModel: z
        .number()
        .positive()
        .optional()
        .describe('Maximum debate rounds per critic (default: 5)'),
      maxTotalTokens: z
        .number()
        .positive()
        .optional()
        .describe('Hard cap on total tokens, triggers early stop'),
      maxEstimatedCost: z
        .number()
        .positive()
        .optional()
        .describe('Hard cap on estimated cost in USD, triggers early stop'),
      includeTranscripts: z
        .boolean()
        .optional()
        .describe('Include full debate transcripts in output (default: false)'),
      models: z
        .object({
          chatgpt: z.string().optional().describe('ChatGPT model ID (default: gpt-4o)'),
          gemini: z.string().optional().describe('Gemini model ID (default: gemini-1.5-pro)'),
        })
        .optional()
        .describe('Model configuration'),
    })
    .optional()
    .describe('Optional runtime configuration'),
};

const HealthParamsSchema = {
  forceRefresh: z
    .boolean()
    .optional()
    .describe('Force refresh provider validation (default: false)'),
};

export function createServer(config: GauntletConfig): McpServer {
  const server = new McpServer({
    name: 'prd-gauntlet',
    version: '1.0.0',
  });

  // Register run_prd_gauntlet tool
  server.tool(
    'run_prd_gauntlet',
    'Orchestrate multi-model PRD refinement. Claude defends the PRD against critiques from ChatGPT and Gemini until consensus is reached.',
    RunGauntletParamsSchema,
    async (params) => {
      logger.logDebug('run_prd_gauntlet called', { hasMetadata: !!params.metadata });

      const result = await handleRunGauntlet(params, config);

      // Check if it's an error
      if ('error' in result) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  // Register gauntlet_health tool
  server.tool(
    'gauntlet_health',
    'Check server health, provider status, and configuration.',
    HealthParamsSchema,
    async (params) => {
      logger.logDebug('gauntlet_health called', { forceRefresh: params.forceRefresh });

      const result = await handleHealth(params, config);

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    }
  );

  logger.logInfo('MCP server created with tools: run_prd_gauntlet, gauntlet_health');

  return server;
}
