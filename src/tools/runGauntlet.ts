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
import { checkPrdSize } from '../utils/tokens.js';
import { getGlobalRateLimiter, initGlobalRateLimiter } from '../utils/rateLimiter.js';
import { memoryMonitor } from '../utils/memoryMonitor.js';
import { validateWebhookUrl, generateHmacSecret } from '../utils/webhook.js';
import { getTerminologyCacheStats } from '../utils/terminologyCache.js';
import { generateDivergenceReport } from '../utils/divergenceReport.js';
import { saveJobToDisk } from '../utils/jobPersistence.js';

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
      apiTimeoutMs: z.number().positive().optional(),
      includeTranscripts: z.boolean().optional(),
      forceUnlockReverts: z.boolean().optional(), // FR6: Override revert locks
      transcriptSummaryOnly: z.boolean().optional(), // v3.0: Return condensed summary
      targetedSections: z.array(z.string()).optional(), // v3.0: Sections for targeted re-debate
      useFullConsensus: z.boolean().optional(), // v3.0: Use 5-threshold consensus
      webhookUrl: z.string().optional(), // v3.0: Webhook for notifications
      webhookAuth: z
        .object({
          type: z.enum(['bearer', 'hmac']),
          token: z.string().optional(),
        })
        .optional(),
      models: z
        .object({
          claude: z.string().optional(),
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

  // FR1: Check PRD size (80% of context window = 128K tokens)
  const sizeCheck = checkPrdSize(validInput.prd);
  if (!sizeCheck.ok) {
    return {
      error: 'PRD_TOO_LARGE',
      message: `PRD exceeds recommended input size. PRD token count: ${sizeCheck.tokens}, Maximum allowed: ${sizeCheck.limit}. Consider breaking into smaller documents or using a model with larger context window.`,
      details: {
        tokenCount: sizeCheck.tokens,
        maxAllowed: sizeCheck.limit,
      },
    };
  }

  // FR12: Check rate limit
  const rateLimiter = initGlobalRateLimiter(baseConfig.rateLimiting);
  const rateCheck = rateLimiter.tryAcquire();
  if (!rateCheck.allowed) {
    logger.logRateLimitExceeded('server', rateCheck.retryAfter);
    return {
      error: 'RATE_LIMIT_EXCEEDED',
      message: `Rate limit exceeded. Please wait ${rateCheck.retryAfter} seconds before trying again.`,
      details: {
        retryAfter: rateCheck.retryAfter,
      },
    };
  }

  // v3.0: Check memory capacity
  const memoryCapacity = memoryMonitor.checkCapacity();
  if (!memoryCapacity.hasCapacity) {
    logger.logWarn('Memory capacity exceeded', {
      heapUsedPercent: memoryCapacity.heapUsedPercent,
      recommendation: memoryCapacity.recommendation,
    });
    return {
      error: 'CONFIG_ERROR',
      message: `Server memory is at ${memoryCapacity.heapUsedPercent.toFixed(1)}% capacity. ${memoryCapacity.recommendation}`,
    };
  }

  // v3.0: Validate webhook URL if provided
  let webhookSecret: string | undefined;
  if (validInput.config?.webhookUrl) {
    const webhookValidation = validateWebhookUrl(validInput.config.webhookUrl);
    if (!webhookValidation.valid) {
      return {
        error: 'INVALID_INPUT',
        message: `Invalid webhook URL: ${webhookValidation.error}`,
      };
    }

    // Generate HMAC secret if using HMAC auth
    if (validInput.config?.webhookAuth?.type === 'hmac') {
      webhookSecret = generateHmacSecret();
      logger.logInfo('Generated HMAC webhook secret', { jobId: 'pending' });
    }
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
  logger.logJobStarted(jobId, validInput.metadata?.title, config.models);

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
    // v3.0 enhancements
    transcriptSummaryOnly: validInput.config?.transcriptSummaryOnly,
    targetedSections: validInput.config?.targetedSections,
    useFullConsensus: validInput.config?.useFullConsensus ?? true, // Default to v3.0 full consensus
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

  // v3.0: Check if consensus was reached by all critics
  const allDebatesReached = Object.values(debates).every(
    (d) => d && d.outcome === 'consensus'
  );
  const consensusFailed = !allDebatesReached && !stoppedEarly;

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

  // v3.0: Add cache stats if terminology research was used
  const cacheStats = getTerminologyCacheStats();
  if (cacheStats.hits > 0 || cacheStats.misses > 0) {
    output.stats.cacheStats = {
      hits: cacheStats.hits,
      misses: cacheStats.misses,
      entries: cacheStats.size,
    };
  }

  // v3.0: Add rolling average stats
  const rollingStats = CostTracker.getRollingAverageStats();
  if (rollingStats.length > 0) {
    output.stats.rollingAverageTokens = rollingStats;
  }

  // v3.0: Generate divergence report if consensus failed
  if (consensusFailed) {
    // Calculate total issues from changelog
    const totalIssuesRaised = changelog.getChangelog().length;
    const issuesResolved = changelog.getChangelog().filter(
      (c) => !c.revertedChange
    ).length;

    const divergenceReport = generateDivergenceReport({
      finalPrd: currentPrd,
      changelog: changelog.getChangelog(),
      chatgptFinalCritique: debates.chatgpt?.unresolvedConcerns?.join('; '),
      geminiFinalCritique: debates.gemini?.unresolvedConcerns?.join('; '),
      roundsCompleted: totalRounds,
      totalIssuesRaised,
      issuesResolved,
    });

    output.divergenceReport = divergenceReport;

    logger.logInfo('Divergence report generated', {
      jobId,
      unresolvedSections: divergenceReport.unresolvedSections.length,
    });
  }

  // v3.0: Include webhook secret if generated
  if (webhookSecret) {
    output.webhookSecret = webhookSecret;
  }

  // Complete job
  jobStore.complete(jobId, output);

  logger.logJobCompleted(jobId, {
    rounds: totalRounds,
    cost: costTracker.getEstimatedCostRounded(),
    outcome: stoppedEarly ? 'early_stop' : consensusFailed ? 'consensus_failed' : 'complete',
  });

  // Auto-save completed job to disk
  try {
    await saveJobToDisk(jobId, output);
    logger.logInfo('Job auto-saved to disk', { jobId });
  } catch (error) {
    logger.logWarn('Failed to auto-save job to disk', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    // Don't fail the job if save fails
  }

  return output;
}
