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
  JobStatus,
  OutputSummary,
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
): Promise<{ jobId: string; status: string; jobType: string; webhookSecret?: string } | GauntletError> {
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

  // S-8: Validate maxRoundsPerModel >= 2
  if (validInput.config?.maxRoundsPerModel !== undefined && validInput.config.maxRoundsPerModel < 2) {
    return {
      error: 'INVALID_INPUT',
      message: 'maxRoundsPerModel must be at least 2. Consensus requires a minimum of 2 rounds.',
    };
  }

  // v3.0: Validate webhook URL if provided
  let webhookSecret: string | undefined;
  if (validInput.config?.webhookUrl) {
    const webhookValidation = await validateWebhookUrl(validInput.config.webhookUrl);
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

  // Create job with jobType: 'prd_refinement'
  let jobId: string;
  try {
    jobId = jobStore.create('prd_refinement');
  } catch (error) {
    return {
      error: 'CONFIG_ERROR',
      message: error instanceof Error ? error.message : 'Failed to create job',
    };
  }

  logger.logJobCreated(jobId);
  logger.logJobStarted(jobId, validInput.metadata?.title, config.models);

  // D2: Return immediately with job handle
  const immediateResponse = {
    jobId,
    status: 'idle' as const,
    jobType: 'prd_refinement' as const,
    ...(webhookSecret && { webhookSecret }),
  };

  // D2: Run debate asynchronously — same pattern as reviewBuildSpecs.ts
  setImmediate(async () => {
    try {
      await runPrdDebate({ jobId, validInput, config, baseConfig, webhookSecret });
    } catch (error) {
      logger.logError('PRD gauntlet debate failed unexpectedly', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      jobStore.fail(jobId, {
        error: 'PROVIDER_ERROR',
        message: 'PRD gauntlet debate encountered an error. Check server logs.',
      });
    }
  });

  return immediateResponse;
}

interface PrdDebateParams {
  jobId: string;
  validInput: GauntletInput;
  config: GauntletConfig;
  baseConfig: GauntletConfig;
  webhookSecret?: string;
}

async function runPrdDebate({ jobId, validInput, config, webhookSecret }: PrdDebateParams): Promise<void> {
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
    return;
  }

  if (!chatgptAvailable) {
    if (config.fallbackPolicy.onModelUnavailable === 'error') {
      jobStore.fail(jobId, {
        error: 'PROVIDER_ERROR',
        message: 'ChatGPT is unavailable and fallback policy is set to error.',
      });
      return;
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
      return;
    }
    skippedCritics.push({
      model: 'gemini',
      reason: validationCache?.gemini.error || 'Model unavailable',
    });
  }

  // If all critics are skipped, store output and mark complete
  if (skippedCritics.length === 2) {
    const summary: OutputSummary = {
      totalRounds: 0,
      chatgptRounds: 0,
      geminiRounds: 0,
      consensusReached: false,
      totalTokens: 0,
      estimatedCost: 0,
    };
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
      summary,
      status: 'complete',
      consensusReached: false,
    };
    // D6: Store clean output without webhookSecret
    jobStore.complete(jobId, output);
    return;
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
  // Bug 1: Split stoppedEarly into resourceCapExhausted (global resource caps only).
  // ChatGPT early_stop due to protocol/error does NOT gate Gemini — only cost/token caps do.
  let resourceCapExhausted: { reason: 'cost_cap' | 'token_cap'; details: string } | null = null;

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

      // Store summary
      debates.chatgpt = result.transcript.summary;

      // Update partial result
      jobStore.updateDebateProgress(
        jobId,
        'chatgpt',
        result.transcript.summary.rounds,
        currentPrd,
        changelog.getChangelog()
      );

      // Bug 1: Only set resourceCapExhausted for global resource caps (cost/token).
      // Protocol violations, timeouts, and other early_stop reasons do NOT gate Gemini.
      if (result.outcome === 'early_stop') {
        if (costTracker.hasExceededCostCap(config.maxEstimatedCost || Infinity)) {
          resourceCapExhausted = { reason: 'cost_cap', details: result.unresolvedConcerns.join('; ') };
        } else if (costTracker.hasExceededTokenCap(config.maxTotalTokens || Infinity)) {
          resourceCapExhausted = { reason: 'token_cap', details: result.unresolvedConcerns.join('; ') };
        }
        // Per-critic outcome is already tracked in debates.chatgpt.outcome
      }
    } catch (error) {
      logger.logProviderError(jobId, 'chatgpt', error instanceof Error ? error.message : 'Unknown error');

      if (config.fallbackPolicy.onModelUnavailable === 'error') {
        jobStore.fail(jobId, {
          error: 'PROVIDER_ERROR',
          message: 'ChatGPT debate encountered an error. Check server logs for details.',
        });
        return;
      }

      skippedCritics.push({
        model: 'chatgpt',
        reason: 'Provider error (see server logs)',
      });
    }
  }

  // Run Gemini debate (if resource caps not exhausted and available)
  if (geminiAvailable && !resourceCapExhausted) {
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

      // Bug 1: Same pattern — only resource caps propagate to resourceCapExhausted
      if (result.outcome === 'early_stop') {
        if (costTracker.hasExceededCostCap(config.maxEstimatedCost || Infinity)) {
          resourceCapExhausted = { reason: 'cost_cap', details: result.unresolvedConcerns.join('; ') };
        } else if (costTracker.hasExceededTokenCap(config.maxTotalTokens || Infinity)) {
          resourceCapExhausted = { reason: 'token_cap', details: result.unresolvedConcerns.join('; ') };
        }
      }
    } catch (error) {
      logger.logProviderError(jobId, 'gemini', error instanceof Error ? error.message : 'Unknown error');

      if (config.fallbackPolicy.onModelUnavailable === 'error') {
        jobStore.fail(jobId, {
          error: 'PROVIDER_ERROR',
          message: 'Gemini debate encountered an error. Check server logs for details.',
        });
        return;
      }

      skippedCritics.push({
        model: 'gemini',
        reason: 'Provider error (see server logs)',
      });
    }
  }

  // v3.0: Check if consensus was reached by all critics
  const allDebatesReached = Object.values(debates).every(
    (d) => d && d.outcome === 'consensus'
  );
  // Bug 1: Use resourceCapExhausted (not the old stoppedEarly boolean) to gate consensus_failed
  const consensusFailed = !allDebatesReached && !resourceCapExhausted;

  // Bug 1b (S10): If BOTH critics ran but both failed (early_stop/error), status → error
  const allCriticsFailed = Object.keys(debates).length > 0 && Object.values(debates).every(
    (d) => d && (d.outcome === 'early_stop' || (d.outcome as string) === 'error')
  );
  if (allCriticsFailed && skippedCritics.length === 0) {
    logger.logError('All critics failed — marking job as error', { jobId });
  }

  // v4.0: Check if any debate produced incomplete output
  const hasIncompleteOutput = Object.values(debates).some(
    (d) => d && d.outcome === 'incomplete_output'
  );

  // Build final output
  const tokenCounts = costTracker.getTokenCountByModel();
  const totalTokens = tokenCounts.claude + tokenCounts.chatgpt + tokenCounts.gemini;

  // D1: Build OutputSummary
  const cacheStats = getTerminologyCacheStats();
  const summary: OutputSummary = {
    totalRounds,
    chatgptRounds: debates.chatgpt?.rounds ?? 0,
    geminiRounds: debates.gemini?.rounds ?? 0,
    consensusReached: allDebatesReached,
    totalTokens,
    estimatedCost: costTracker.getEstimatedCostRounded(),
    ...(cacheStats.hits > 0 || cacheStats.misses > 0
      ? {
          cacheHits: cacheStats.hits,
          cacheMisses: cacheStats.misses,
        }
      : {}),
  };

  // Bug 1d: Cost starvation visibility — add note if Gemini was limited due to resource cap
  if (resourceCapExhausted && debates.gemini && (debates.gemini as DebateSummary).rounds <= 1) {
    (summary as any).notes = (summary as any).notes || [];
    (summary as any).notes.push(
      `Gemini review was limited to ${(debates.gemini as DebateSummary).rounds} round(s) due to ${resourceCapExhausted.reason}. Consider increasing the budget for full dual-critic coverage.`
    );
  }

  // Build stoppedEarly stats field (legacy shape) if resource caps triggered
  const stoppedEarlyStats = resourceCapExhausted
    ? {
        reason: resourceCapExhausted.reason,
        atModel: (debates.gemini ? 'gemini' : 'chatgpt') as 'chatgpt' | 'gemini',
        unresolvedConcerns: [resourceCapExhausted.details],
      }
    : undefined;

  // D6: Build output WITHOUT webhookSecret
  const output: GauntletOutput = {
    jobId,
    finalPrd: currentPrd,
    changelog: changelog.getChangelog(),
    stats: {
      totalRounds,
      tokensUsed: tokenCounts,
      estimatedCost: costTracker.getEstimatedCostRounded(),
      ...(stoppedEarlyStats && { stoppedEarly: stoppedEarlyStats }),
      ...(skippedCritics.length > 0 && { skippedCritics }),
    },
    summary,
  };

  // Only include debates if at least one critic ran
  if (Object.keys(debates).length > 0) {
    output.debates = debates;
  }

  // v3.0: Add cache stats if terminology research was used
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

  // v4.0: Determine final job status based on outcomes
  let finalStatus: JobStatus = 'complete';
  if (allCriticsFailed && skippedCritics.length === 0) {
    // Bug 1b (S10): Both critics ran but both failed → error (not consensus_failed)
    finalStatus = 'error';
  } else if (hasIncompleteOutput) {
    finalStatus = 'incomplete_output';
  } else if (consensusFailed) {
    finalStatus = 'consensus_failed';
  }

  // D4: Persist status and consensusReached on the output for disk retrieval
  output.status = finalStatus;
  output.consensusReached = allDebatesReached;

  // D6: Store clean output (no webhookSecret) in memory
  jobStore.complete(jobId, output, finalStatus);

  logger.logJobCompleted(jobId, {
    rounds: totalRounds,
    cost: costTracker.getEstimatedCostRounded(),
    outcome: hasIncompleteOutput ? 'incomplete_output' : resourceCapExhausted ? 'early_stop' : consensusFailed ? 'consensus_failed' : 'complete',
  });

  // Auto-save completed job to disk (D6: webhookSecret was never placed on output object)
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
}
