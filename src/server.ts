// ============================================================================
// MCP Server Setup - Tool registration
// ============================================================================

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import type { GauntletConfig } from './types/index.js';
import { handleRunGauntlet } from './tools/runGauntlet.js';
import { handleHealth } from './tools/health.js';
import { handleCheckStatus } from './tools/checkStatus.js';
import { handleGetTranscript } from './tools/getTranscript.js';
import { handleListJobs } from './tools/listJobs.js';
import { handleClearCache } from './tools/clearCache.js';
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
      apiTimeoutMs: z
        .number()
        .positive()
        .optional()
        .describe('Per-API-call timeout in ms (default: 600000 / 10 min)'),
      includeTranscripts: z
        .boolean()
        .optional()
        .describe('Include full debate transcripts in output (default: false)'),
      transcriptSummaryOnly: z
        .boolean()
        .optional()
        .describe('v3.0: Return condensed 2-5KB summaries instead of full transcripts'),
      targetedSections: z
        .array(z.string())
        .optional()
        .describe('v3.0: Hierarchical section paths for targeted re-debate'),
      useFullConsensus: z
        .boolean()
        .optional()
        .describe('v3.0: Use 5-threshold consensus validation (default: true)'),
      webhookUrl: z
        .string()
        .optional()
        .describe('v3.0: URL for async user input notifications'),
      webhookAuth: z
        .object({
          type: z.enum(['bearer', 'hmac']).describe('Authentication method'),
          token: z.string().optional().describe('Bearer token (required for bearer auth)'),
        })
        .optional()
        .describe('v3.0: Webhook authentication configuration'),
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

const CheckStatusParamsSchema = {
  jobId: z.string().uuid().describe('The job ID to check status for'),
};

const GetTranscriptParamsSchema = {
  jobId: z.string().uuid().describe('The job ID to retrieve transcript from'),
  model: z.enum(['chatgpt', 'gemini']).describe('Which critic transcript to retrieve'),
};

const ListJobsParamsSchema = {
  status: z
    .enum(['idle', 'debating_chatgpt', 'debating_gemini', 'complete', 'error', 'all'])
    .optional()
    .describe('Filter by job status (default: all)'),
  limit: z
    .number()
    .positive()
    .max(100)
    .optional()
    .describe('Maximum number of jobs to return (default: 50, max: 100)'),
};

export function createServer(config: GauntletConfig): McpServer {
  const server = new McpServer({
    name: 'prd-gauntlet',
    version: '3.0.0', // Updated to v3.0 with enhanced features
  });

  // Register run_prd_gauntlet tool
  server.tool(
    'run_prd_gauntlet',
    'v3.0: Orchestrate multi-model PRD refinement with enhanced consensus validation, loop detection, size enforcement, and optional webhooks. Claude defends the PRD against critiques from ChatGPT and Gemini until 5-threshold consensus is reached.',
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

  // Register check_gauntlet_status tool (FR2)
  server.tool(
    'check_gauntlet_status',
    'Check the status of a running or completed gauntlet job. Returns current progress, partial results, or final PRD.',
    CheckStatusParamsSchema,
    async (params) => {
      logger.logDebug('check_gauntlet_status called', { jobId: params.jobId });

      const result = handleCheckStatus(params);

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

  // Register get_debate_transcript tool (FR3)
  server.tool(
    'get_debate_transcript',
    'Retrieve the full debate transcript for a specific critic from a completed gauntlet job.',
    GetTranscriptParamsSchema,
    async (params) => {
      logger.logDebug('get_debate_transcript called', { jobId: params.jobId, model: params.model });

      const result = handleGetTranscript(params);

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

  // Register list_gauntlet_jobs tool
  server.tool(
    'list_gauntlet_jobs',
    'List running and completed gauntlet jobs. Use this to recover job IDs after client timeout.',
    ListJobsParamsSchema,
    async (params) => {
      logger.logDebug('list_gauntlet_jobs called', { status: params.status, limit: params.limit });

      const result = handleListJobs(params);

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

  // Register clear_terminology_cache tool (PRD v3.0)
  server.tool(
    'clear_terminology_cache',
    'Manually invalidate the shared terminology cache. Use this to force re-research of technical terms.',
    {},
    async () => {
      logger.logDebug('clear_terminology_cache called');

      const result = handleClearCache();

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

  logger.logInfo('MCP server created with tools: run_prd_gauntlet, gauntlet_health, check_gauntlet_status, get_debate_transcript, list_gauntlet_jobs, clear_terminology_cache');

  return server;
}
