// ============================================================================
// run_prd_gauntlet Tool - Main gauntlet orchestration (FR1)
// ============================================================================

import { z } from 'zod';
import type {
  GauntletInput,
  GauntletOutput,
  GauntletError,
  GauntletConfig,
  DebateSummary,
  CriticModel,
} from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';
import { CostTracker } from '../utils/cost.js';
import { ChangelogManager } from '../utils/changelog.js';
import { mergeWithRuntimeConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { isModelAvailable, getValidationCache } from '../clients/validator.js';
import { runDebate, type DebateConfig } from '../debate/engine.js';

// Input schema for validation
export const RunGauntletInputSchema = z.object({
  prd: z.string().min(1, 'PRD content cannot be empty'),
  metadata: z
    .object({
      title: z.string().optional(),
      productContext: z.string().optional(),
      constraints: z.array(z.string()).optional(),
    })
    .optional(),
  config: z
    .object({
      maxRoundsPerModel: z.number().positive().optional(),
      maxTotalTokens: z.number().positive().optional(),
      maxEstimatedCost: z.number().positive().optional(),
      includeTranscripts: z.boolean().optional(),
      models: z
        .object({
          chatgpt: z.string().optional(),
          gemini: z.string().optional(),
        })
        .optional(),
    })
    .optional(),
});

export type RunGauntletInput = z.infer<typeof RunGauntletInputSchema>;

export async function handleRunGauntlet(
  input: unknown,
  baseConfig: GauntletConfig
): Promise<GauntletOutput | GauntletError> {
  // Validate input
  const parseResult = RunGauntletInputSchema.safeParse(input);
  if (!parseResult.success) {
    const issues = parseResult.error.issues;
    return {
      error: 'INVALID_INPUT',
      message: issues.map((e) => e.message).join('; '),
      details: { errors: issues },
    };
  }

  const validInput = parseResult.data as GauntletInput;

  // Check for empty PRD
  if (!validInput.prd.trim()) {
    return {
      error: 'INVALID_INPUT',
      message: 'PRD content cannot be empty',
    };
  }

  // Merge runtime config
  const config = mergeWithRuntimeConfig(baseConfig, validInput.config);

  // Create job
  let jobId: string;
  try {
    jobId = jobStore.create();
  } catch (error) {
    return {
      error: 'CONFIG_ERROR',
      message: error instanceof Error ? error.message : 'Failed to create job',
    };
  }

  logger.logJobCreated(jobId);

  // Check model availability
  const validationCache = getValidationCache();
  const skippedCritics: Array<{ model: CriticModel; reason: string }> = [];

  const chatgptAvailable = isModelAvailable('chatgpt');
  const geminiAvailable = isModelAvailable('gemini');
  const claudeAvailable = isModelAvailable('claude');

  if (!claudeAvailable) {
    jobStore.fail(jobId, {
      error: 'PROVIDER_ERROR',
      message: 'Claude (defender) is unavailable. Cannot proceed with gauntlet.',
    });
    return {
      error: 'PROVIDER_ERROR',
      message: 'Claude (defender) is unavailable. Cannot proceed with gauntlet.',
      details: { validation: validationCache?.claude },
    };
  }

  if (!chatgptAvailable) {
    if (config.fallbackPolicy.onModelUnavailable === 'error') {
      jobStore.fail(jobId, {
        error: 'PROVIDER_ERROR',
        message: 'ChatGPT is unavailable and fallback policy is set to error.',
      });
      return {
        error: 'PROVIDER_ERROR',
        message: 'ChatGPT is unavailable and fallback policy is set to error.',
      };
    }
    skippedCritics.push({
      model: 'chatgpt',
      reason: validationCache?.chatgpt.error || 'Model unavailable',
    });
  }

  if (!geminiAvailable) {
    if (config.fallbackPolicy.onModelUnavailable === 'error') {
      jobStore.fail(jobId, {
        error: 'PROVIDER_ERROR',
        message: 'Gemini is unavailable and fallback policy is set to error.',
      });
      return {
        error: 'PROVIDER_ERROR',
        message: 'Gemini is unavailable and fallback policy is set to error.',
      };
    }
    skippedCritics.push({
      model: 'gemini',
      reason: validationCache?.gemini.error || 'Model unavailable',
    });
  }

  // If all critics are skipped, return original PRD
  if (skippedCritics.length === 2) {
    const output: GauntletOutput = {
      jobId,
      finalPrd: validInput.prd,
      changelog: [],
      stats: {
        totalRounds: 0,
        tokensUsed: { claude: 0, chatgpt: 0, gemini: 0 },
        estimatedCost: 0,
        skippedCritics,
      },
    };
    jobStore.complete(jobId, output);
    return output;
  }

  // Initialize tracking
  const costTracker = new CostTracker(config.costRates);
  const changelog = new ChangelogManager();

  // Prepare debate config
  const debateConfig: DebateConfig = {
    maxRounds: config.maxRoundsPerModel,
    maxTotalTokens: config.maxTotalTokens,
    maxEstimatedCost: config.maxEstimatedCost,
    retryOnTimeout: config.retryOnTimeout,
    metadata: {
      productContext: validInput.metadata?.productContext,
      constraints: validInput.metadata?.constraints,
    },
  };

  let currentPrd = validInput.prd;
  let totalRounds = 0;
  const debates: {
    chatgpt?: DebateSummary;
    gemini?: DebateSummary;
  } = {};
  let stoppedEarly: GauntletOutput['stats']['stoppedEarly'];

  // Run ChatGPT debate
  if (chatgptAvailable) {
    try {
      jobStore.updateStatus(jobId, 'debating_chatgpt');

      const result = await runDebate(
        {
          jobId,
          prd: currentPrd,
          critic: 'chatgpt',
          config: debateConfig,
          costTracker,
          changelog,
        },
        config
      );

      currentPrd = result.finalPrd;
      totalRounds += result.transcript.summary.rounds;

      // Store transcript
      jobStore.storeTranscript(jobId, 'chatgpt', result.transcript);

      // Store summary (or full transcript if requested)
      if (config.includeTranscripts || validInput.config?.includeTranscripts) {
        debates.chatgpt = result.transcript.summary;
      } else {
        debates.chatgpt = result.transcript.summary;
      }

      // Update partial result
      jobStore.updateDebateProgress(
        jobId,
        'chatgpt',
        result.transcript.summary.rounds,
        currentPrd,
        changelog.getChangelog()
      );

      // Check for early stop
      if (result.outcome === 'early_stop') {
        stoppedEarly = {
          reason: costTracker.hasExceededCostCap(config.maxEstimatedCost || Infinity)
            ? 'cost_cap'
            : costTracker.hasExceededTokenCap(config.maxTotalTokens || Infinity)
              ? 'token_cap'
              : 'timeout',
          atModel: 'chatgpt',
          unresolvedConcerns: result.unresolvedConcerns,
        };
      }
    } catch (error) {
      logger.logProviderError(jobId, 'chatgpt', error instanceof Error ? error.message : 'Unknown error');

      if (config.fallbackPolicy.onModelUnavailable === 'error') {
        jobStore.fail(jobId, {
          error: 'PROVIDER_ERROR',
          message: `ChatGPT debate failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
        return {
          error: 'PROVIDER_ERROR',
          message: `ChatGPT debate failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }

      skippedCritics.push({
        model: 'chatgpt',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Run Gemini debate (if not stopped early and available)
  if (geminiAvailable && !stoppedEarly) {
    try {
      jobStore.updateStatus(jobId, 'debating_gemini');

      const result = await runDebate(
        {
          jobId,
          prd: currentPrd,
          critic: 'gemini',
          config: debateConfig,
          costTracker,
          changelog,
          previousChangelog: changelog.getChangelogSummary(),
        },
        config
      );

      currentPrd = result.finalPrd;
      totalRounds += result.transcript.summary.rounds;

      // Store transcript
      jobStore.storeTranscript(jobId, 'gemini', result.transcript);

      // Store summary
      debates.gemini = result.transcript.summary;

      // Check for early stop
      if (result.outcome === 'early_stop') {
        stoppedEarly = {
          reason: costTracker.hasExceededCostCap(config.maxEstimatedCost || Infinity)
            ? 'cost_cap'
            : costTracker.hasExceededTokenCap(config.maxTotalTokens || Infinity)
              ? 'token_cap'
              : 'timeout',
          atModel: 'gemini',
          unresolvedConcerns: result.unresolvedConcerns,
        };
      }
    } catch (error) {
      logger.logProviderError(jobId, 'gemini', error instanceof Error ? error.message : 'Unknown error');

      if (config.fallbackPolicy.onModelUnavailable === 'error') {
        jobStore.fail(jobId, {
          error: 'PROVIDER_ERROR',
          message: `Gemini debate failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        });
        return {
          error: 'PROVIDER_ERROR',
          message: `Gemini debate failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }

      skippedCritics.push({
        model: 'gemini',
        reason: error instanceof Error ? error.message : 'Unknown error',
      });
    }
  }

  // Build final output
  const tokenCounts = costTracker.getTokenCountByModel();
  const output: GauntletOutput = {
    jobId,
    finalPrd: currentPrd,
    changelog: changelog.getChangelog(),
    stats: {
      totalRounds,
      tokensUsed: tokenCounts,
      estimatedCost: costTracker.getEstimatedCostRounded(),
      ...(stoppedEarly && { stoppedEarly }),
      ...(skippedCritics.length > 0 && { skippedCritics }),
    },
  };

  // Only include debates if at least one critic ran
  if (Object.keys(debates).length > 0) {
    output.debates = debates;
  }

  // Complete job
  jobStore.complete(jobId, output);

  logger.logJobCompleted(jobId, {
    rounds: totalRounds,
    cost: costTracker.getEstimatedCostRounded(),
    outcome: stoppedEarly ? 'early_stop' : 'complete',
  });

  return output;
}
