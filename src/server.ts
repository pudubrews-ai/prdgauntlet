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
import { handleSaveJobOutput } from './tools/saveJobOutput.js';
import { handleLoadSavedJob } from './tools/loadSavedJob.js';
import { handleGetSavedPrd } from './tools/getSavedPrd.js';
import { handleListSavedJobs } from './tools/listSavedJobs.js';
import { handleReviewBuildSpecs } from './tools/reviewBuildSpecs.js';
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
    .enum([
      'idle',
      'debating_chatgpt',
      'debating_gemini',
      'awaiting_user_input',
      'complete',
      'error',
      'consensus_failed',
      'incomplete_output',
      'all',
    ])
    .optional()
    .describe('Filter by job status (default: all)'),
  jobType: z
    .enum(['prd_refinement', 'build_spec_review', 'all'])
    .optional()
    .describe('v4.0: Filter by job type (default: all)'),
  limit: z
    .number()
    .positive()
    .max(100)
    .optional()
    .describe('Maximum number of jobs to return (default: 50, max: 100)'),
};

const SaveJobOutputParamsSchema = {
  jobId: z.string().uuid().describe('The job ID to save to disk'),
};

const LoadSavedJobParamsSchema = {
  jobId: z.string().uuid().describe('The saved job ID to load from disk'),
};

const GetSavedPrdParamsSchema = {
  jobId: z.string().uuid().describe('The saved job ID to extract PRD from'),
  outputFile: z.string().optional().describe('Optional file path to save PRD markdown'),
};

const ListSavedJobsParamsSchema = {};

export function createServer(config: GauntletConfig): McpServer {
  const server = new McpServer({
    name: 'prd-gauntlet',
    version: '4.0.0', // Updated to v4.0 with build spec review mode
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
    'v4.0: List running and completed gauntlet jobs. Supports filtering by status and jobType (prd_refinement, build_spec_review). Use this to recover job IDs after client timeout.',
    ListJobsParamsSchema,
    async (params) => {
      logger.logDebug('list_gauntlet_jobs called', { status: params.status, limit: params.limit });

      const result = await handleListJobs(params as any);

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

  // Register save_job_output tool
  server.tool(
    'save_job_output',
    'Manually save a completed gauntlet job to disk for later retrieval. Jobs are auto-saved on completion, but this can be used for ephemeral jobs.',
    SaveJobOutputParamsSchema,
    async (params) => {
      logger.logDebug('save_job_output called', { jobId: params.jobId });

      const result = await handleSaveJobOutput(params, config);

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

  // Register load_saved_job tool
  server.tool(
    'load_saved_job',
    'Load a complete gauntlet job output from disk. Returns full output including PRD, changelog, debates, and stats without truncation.',
    LoadSavedJobParamsSchema,
    async (params) => {
      logger.logDebug('load_saved_job called', { jobId: params.jobId });

      const result = await handleLoadSavedJob(params, config);

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

  // Register get_saved_prd tool
  server.tool(
    'get_saved_prd',
    'v4.0: Extract the final output from a saved job. For PRD refinement jobs, returns refinedPrd. For build spec review jobs, returns refinedAppSpecSection and refinedTestSpec. Dual-mode support.',
    GetSavedPrdParamsSchema,
    async (params) => {
      logger.logDebug('get_saved_prd called', { jobId: params.jobId, outputFile: params.outputFile });

      const result = await handleGetSavedPrd(params, config);

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

  // Register list_saved_jobs tool
  server.tool(
    'list_saved_jobs',
    'List all saved gauntlet jobs on disk with metadata. Shows job ID, save date, title, rounds, and cost.',
    ListSavedJobsParamsSchema,
    async () => {
      logger.logDebug('list_saved_jobs called');

      const result = await handleListSavedJobs({}, config);

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

  // Register review_build_specs tool (v4.0)
  server.tool(
    'review_build_specs',
    'v4.0: Review an app spec section and test spec through multi-model AI debate. Claude defends both documents against critiques from ChatGPT and Gemini. Returns refined documents with cross-document alignment analysis. If HMAC auth is configured, the webhookSecret is returned here and nowhere else — store it immediately.',
    {
      appSpecSection: z.string().describe('The app spec section to review and refine'),
      testSpec: z.string().describe('The test spec to review and refine'),
      buildRulesSpec: z.string().optional().describe('Build rules spec for context (not refined)'),
      appSpec: z.string().optional().describe('Full living app spec for consistency checks (not refined)'),
      metadata: z
        .object({
          title: z.string().optional().describe('Document title'),
          version: z.string().optional().describe('Document version'),
          projectContext: z.string().optional().describe('Project context for reviewers'),
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
            .describe('Maximum debate rounds per critic (default: 3, min: 2)'),
          maxTotalTokens: z.number().positive().optional().describe('Hard cap on total tokens'),
          maxEstimatedCost: z.number().positive().optional().describe('Hard cap on estimated cost (USD)'),
          apiTimeoutMs: z.number().positive().optional().describe('Per-API-call timeout in ms'),
          includeTranscripts: z.boolean().optional().describe('Include full debate transcripts'),
          webhookUrl: z.string().optional().describe('URL for async completion notifications (HTTPS)'),
          webhookAuth: z
            .object({
              type: z.enum(['bearer', 'hmac']).describe('Authentication method'),
              token: z.string().optional().describe('Bearer token (required for bearer auth)'),
            })
            .optional()
            .describe('Webhook authentication configuration'),
          models: z
            .object({
              claude: z.string().optional().describe('Claude model ID'),
              chatgpt: z.string().optional().describe('ChatGPT model ID'),
              gemini: z.string().optional().describe('Gemini model ID'),
            })
            .optional()
            .describe('Model configuration'),
        })
        .optional()
        .describe('Optional runtime configuration'),
    },
    async (params) => {
      logger.logDebug('review_build_specs called', { hasMetadata: !!params.metadata });

      const result = await handleReviewBuildSpecs(params, config);

      if ('error' in result) {
        return {
          content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
          isError: true,
        };
      }

      return {
        content: [{ type: 'text' as const, text: JSON.stringify(result, null, 2) }],
      };
    }
  );

  logger.logInfo('MCP server created with tools: run_prd_gauntlet, gauntlet_health, check_gauntlet_status, get_debate_transcript, list_gauntlet_jobs, clear_terminology_cache, save_job_output, load_saved_job, get_saved_prd, list_saved_jobs, review_build_specs');

  return server;
}
