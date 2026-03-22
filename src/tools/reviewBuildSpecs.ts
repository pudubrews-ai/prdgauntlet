// ============================================================================
// review_build_specs Tool - Build Spec Review orchestration (v4.0)
// ============================================================================

import { z } from 'zod';
import { randomUUID } from 'crypto';
import type {
  GauntletConfig,
  BuildSpecReviewOutput,
  GauntletError,
  CriticModel,
  JobStatus,
  OutputSummary,
  ChangeEntry,
  CrossDocumentReport,
} from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';
import { CostTracker } from '../utils/cost.js';
import { ChangelogManager } from '../utils/changelog.js';
import { mergeWithRuntimeConfig } from '../utils/config.js';
import { logger } from '../utils/logger.js';
import { isModelAvailable } from '../clients/validator.js';
import { runDebate, type DebateConfig } from '../debate/engine.js';
import { validateWebhookUrl, generateHmacSecret } from '../utils/webhook.js';
import { saveJobToDisk } from '../utils/jobPersistence.js';
import { checkSpecReviewFieldSize, checkPrdSize } from '../utils/sizeEnforcement.js';
import { buildSpecReviewCriticPrompt } from '../prompts/specReviewCritic.js';
import { buildSpecReviewDefenderPrompt } from '../prompts/specReviewDefender.js';
import { parseSpecReviewResponse } from '../debate/specReviewParser.js';
import { computeCrossDocumentReport } from '../utils/crossDocumentReport.js';

// Input schema
export const ReviewBuildSpecsInputSchema = z.object({
  appSpecSection: z.string().min(1, 'appSpecSection cannot be empty'),
  testSpec: z.string().min(1, 'testSpec cannot be empty'),
  buildRulesSpec: z.string().optional(),
  appSpec: z.string().optional(),
  metadata: z
    .object({
      title: z.string().optional(),
      version: z.string().optional(),
      projectContext: z.string().optional(),
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
      webhookUrl: z.string().optional(),
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

export type ReviewBuildSpecsInput = z.infer<typeof ReviewBuildSpecsInputSchema>;

/**
 * Generate UUID-prefixed delimiters per job (S-7)
 */
function generateDelimiters(): {
  appSpecStart: string;
  appSpecEnd: string;
  testSpecStart: string;
  testSpecEnd: string;
} {
  const nonce = randomUUID().replace(/-/g, '').slice(0, 12);
  return {
    appSpecStart: `===${nonce}_APP_SPEC_SECTION_START===`,
    appSpecEnd: `===${nonce}_APP_SPEC_SECTION_END===`,
    testSpecStart: `===${nonce}_TEST_SPEC_START===`,
    testSpecEnd: `===${nonce}_TEST_SPEC_END===`,
  };
}

export async function handleReviewBuildSpecs(
  input: unknown,
  baseConfig: GauntletConfig
): Promise<{ jobId: string; status: string; jobType: string; webhookSecret?: string } | GauntletError> {
  // Validate input
  const parseResult = ReviewBuildSpecsInputSchema.safeParse(input);
  if (!parseResult.success) {
    const issues = parseResult.error.issues;
    return {
      error: 'INVALID_INPUT',
      message: issues.map((e) => e.message).join('; '),
      details: { errors: issues },
    };
  }

  const validInput = parseResult.data;

  // Per-field size limits
  const fieldChecks: Array<[keyof typeof validInput, 'appSpecSection' | 'testSpec' | 'buildRulesSpec' | 'appSpec']> = [
    ['appSpecSection', 'appSpecSection'],
    ['testSpec', 'testSpec'],
  ];

  for (const [field, limitKey] of fieldChecks) {
    const value = validInput[field];
    if (typeof value === 'string') {
      const check = checkSpecReviewFieldSize(limitKey, value);
      if (!check.ok) {
        return { error: 'INVALID_INPUT', message: check.error! };
      }
    }
  }

  if (validInput.buildRulesSpec) {
    const check = checkSpecReviewFieldSize('buildRulesSpec', validInput.buildRulesSpec);
    if (!check.ok) return { error: 'INVALID_INPUT', message: check.error! };
  }

  if (validInput.appSpec) {
    const check = checkSpecReviewFieldSize('appSpec', validInput.appSpec);
    if (!check.ok) return { error: 'INVALID_INPUT', message: check.error! };
  }

  // Combined size check (200KB)
  const combined = [
    validInput.appSpecSection,
    validInput.testSpec,
    validInput.buildRulesSpec ?? '',
    validInput.appSpec ?? '',
  ].join('\n');

  const combinedCheck = checkPrdSize(combined, true);
  if (!combinedCheck.ok) {
    return {
      error: 'PRD_TOO_LARGE',
      message: combinedCheck.error ?? `Combined input exceeds the ${combinedCheck.limitKB}KB size limit (actual: ${combinedCheck.sizeKB.toFixed(1)}KB).`,
      details: { sizeKB: combinedCheck.sizeKB, limitKB: combinedCheck.limitKB },
    };
  }

  // S-8: Default maxRoundsPerModel to 3, then validate >= 2
  const maxRoundsPerModel = validInput.config?.maxRoundsPerModel ?? 3;
  if (maxRoundsPerModel < 2) {
    return {
      error: 'INVALID_INPUT',
      message: 'maxRoundsPerModel must be at least 2. Consensus requires a minimum of 2 rounds.',
    };
  }

  // Validate webhook URL if provided
  let webhookSecret: string | undefined;
  if (validInput.config?.webhookUrl) {
    const webhookValidation = await validateWebhookUrl(validInput.config.webhookUrl);
    if (!webhookValidation.valid) {
      return {
        error: 'INVALID_INPUT',
        message: `Invalid webhook URL: ${webhookValidation.error}`,
      };
    }

    if (validInput.config?.webhookAuth?.type === 'hmac') {
      webhookSecret = generateHmacSecret();
      logger.logInfo('Generated HMAC webhook secret for spec review job');
    }
  }

  // Create job with jobType: 'build_spec_review'
  let jobId: string;
  try {
    jobId = jobStore.create('build_spec_review');
  } catch (error) {
    return {
      error: 'CONFIG_ERROR',
      message: error instanceof Error ? error.message : 'Failed to create job',
    };
  }

  logger.logJobCreated(jobId);

  // Generate UUID-prefixed delimiters (S-7) — ephemeral, stored on job context only
  const delimiters = generateDelimiters();

  // Concatenate documents with delimiters for the debate engine
  const concatenatedInput = [
    delimiters.appSpecStart,
    validInput.appSpecSection,
    delimiters.appSpecEnd,
    '',
    delimiters.testSpecStart,
    validInput.testSpec,
    delimiters.testSpecEnd,
  ].join('\n');

  // Merge runtime config
  const config = mergeWithRuntimeConfig(baseConfig, {
    ...(validInput.config ?? {}),
    maxRoundsPerModel,
  });

  // Return immediately with job details (S-1: webhookSecret returned here and nowhere else)
  const immediateResponse = {
    jobId,
    status: 'idle',
    jobType: 'build_spec_review',
    ...(webhookSecret && { webhookSecret }),
  };

  // Run debate asynchronously
  setImmediate(async () => {
    try {
      await runSpecReviewDebate({
        jobId,
        validInput,
        concatenatedInput,
        delimiters,
        config,
        baseConfig,
        webhookSecret,
        maxRoundsPerModel,
      });
    } catch (error) {
      logger.logError('Spec review debate failed unexpectedly', {
        jobId,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      jobStore.fail(jobId, {
        error: 'PROVIDER_ERROR',
        message: 'Spec review debate encountered an error. Check server logs.',
      });
    }
  });

  return immediateResponse;
}

/**
 * D1: Compute issues found breakdown from changelog and cross-document report.
 * Classifies changelog entries heuristically and uses CDR data for cross-document counts.
 */
function computeIssuesFound(
  changelog: ChangeEntry[],
  crossDocumentReport: CrossDocumentReport
): NonNullable<OutputSummary['issuesFound']> {
  // Cross-document counts come directly from CDR
  const stringMismatches = crossDocumentReport.mismatches.filter(m => m.type === 'string_mismatch').length;
  const attributeMismatches = crossDocumentReport.mismatches.filter(m => m.type === 'attribute_mismatch').length;
  const untestedBehavior = Math.max(
    0,
    crossDocumentReport.coverageMatrix.appSpecBehaviors - crossDocumentReport.coverageMatrix.testedBehaviors
  );

  // Classify changelog entries heuristically by summary keywords
  let buildability = 0;
  let completeness = 0;
  let ambiguity = 0;
  let consistency = 0;
  let testability = 0;
  let coverageGaps = 0;
  let testQuality = 0;
  let specAlignment = 0;

  for (const entry of changelog) {
    const s = entry.summary.toLowerCase();
    const section = (entry.section ?? '').toLowerCase();

    // Test-spec related entries
    if (section.includes('test') || s.includes('test')) {
      if (s.includes('coverage') || s.includes('gap')) {
        coverageGaps++;
      } else if (s.includes('quality') || s.includes('assertion') || s.includes('scenario')) {
        testQuality++;
      } else if (s.includes('align') || s.includes('mismatch') || s.includes('inconsist')) {
        specAlignment++;
      } else {
        testability++;
      }
    } else {
      // App spec entries
      if (s.includes('build') || s.includes('compil') || s.includes('deploy')) {
        buildability++;
      } else if (s.includes('missing') || s.includes('incomplete') || s.includes('add')) {
        completeness++;
      } else if (s.includes('ambig') || s.includes('unclear') || s.includes('clarif')) {
        ambiguity++;
      } else {
        consistency++;
      }
    }
  }

  return {
    appSpecSection: { buildability, completeness, ambiguity, consistency },
    testSpec: { testability, coverageGaps, testQuality, specAlignment },
    crossDocument: {
      orphanedTests: 0, // Cannot reliably detect without test runner
      untestedBehavior,
      stringMismatches,
      attributeMismatches,
      implicitDependencies: 0,
      missingPrerequisites: 0,
    },
  };
}

interface SpecReviewDebateParams {
  jobId: string;
  validInput: ReviewBuildSpecsInput;
  concatenatedInput: string;
  delimiters: ReturnType<typeof generateDelimiters>;
  config: GauntletConfig;
  baseConfig: GauntletConfig;
  webhookSecret?: string;
  maxRoundsPerModel: number;
}

async function runSpecReviewDebate({
  jobId,
  validInput,
  concatenatedInput,
  delimiters,
  config,
  maxRoundsPerModel,
}: SpecReviewDebateParams): Promise<void> {
  const costTracker = new CostTracker(config.costRates);
  const changelog = new ChangelogManager();

  const chatgptAvailable = isModelAvailable('chatgpt');
  const geminiAvailable = isModelAvailable('gemini');
  const claudeAvailable = isModelAvailable('claude');

  if (!claudeAvailable) {
    jobStore.fail(jobId, {
      error: 'PROVIDER_ERROR',
      message: 'Claude (defender) is unavailable. Cannot proceed.',
    });
    return;
  }

  // Build critic and defender prompts for spec review mode
  const criticPrompt = buildSpecReviewCriticPrompt({
    productContext: validInput.metadata?.projectContext,
    constraints: validInput.metadata?.constraints,
    buildRulesSpec: validInput.buildRulesSpec,
    appSpec: validInput.appSpec,
  });

  const defenderPrompt = buildSpecReviewDefenderPrompt(delimiters, {
    title: validInput.metadata?.title,
    version: validInput.metadata?.version,
    productContext: validInput.metadata?.projectContext,
    constraints: validInput.metadata?.constraints,
  });

  const debateConfig: DebateConfig = {
    maxRounds: maxRoundsPerModel,
    maxTotalTokens: config.maxTotalTokens,
    maxEstimatedCost: config.maxEstimatedCost,
    retryOnTimeout: config.retryOnTimeout,
    metadata: {
      productContext: validInput.metadata?.projectContext,
      constraints: validInput.metadata?.constraints,
    },
    useFullConsensus: true,
    customCriticPrompt: criticPrompt,
    customDefenderPrompt: defenderPrompt,
  };

  const skippedCritics: Array<{ model: CriticModel; reason: string }> = [];
  let currentDoc = concatenatedInput;
  let totalRounds = 0;
  const debates: BuildSpecReviewOutput['debates'] = {};
  let stoppedEarly = false;

  // Run ChatGPT debate
  if (chatgptAvailable) {
    try {
      jobStore.updateStatus(jobId, 'debating_chatgpt');

      const result = await runDebate(
        {
          jobId,
          prd: currentDoc,
          critic: 'chatgpt',
          config: debateConfig,
          costTracker,
          changelog,
        },
        config
      );

      currentDoc = result.finalPrd;
      totalRounds += result.transcript.summary.rounds;
      jobStore.storeTranscript(jobId, 'chatgpt', result.transcript);
      debates.chatgpt = result.transcript.summary;

      if (result.outcome === 'early_stop') {
        stoppedEarly = true;
      }
    } catch (error) {
      logger.logProviderError(jobId, 'chatgpt', error instanceof Error ? error.message : 'Unknown');
      skippedCritics.push({ model: 'chatgpt', reason: 'Provider error (see server logs)' });
    }
  } else {
    skippedCritics.push({ model: 'chatgpt', reason: 'ChatGPT unavailable' });
  }

  // Run Gemini debate
  if (geminiAvailable && !stoppedEarly) {
    try {
      jobStore.updateStatus(jobId, 'debating_gemini');

      const result = await runDebate(
        {
          jobId,
          prd: currentDoc,
          critic: 'gemini',
          config: debateConfig,
          costTracker,
          changelog,
          previousChangelog: changelog.getChangelogSummary(),
        },
        config
      );

      currentDoc = result.finalPrd;
      totalRounds += result.transcript.summary.rounds;
      jobStore.storeTranscript(jobId, 'gemini', result.transcript);
      debates.gemini = result.transcript.summary;

      if (result.outcome === 'early_stop') {
        stoppedEarly = true;
      }
    } catch (error) {
      logger.logProviderError(jobId, 'gemini', error instanceof Error ? error.message : 'Unknown');
      skippedCritics.push({ model: 'gemini', reason: 'Provider error (see server logs)' });
    }
  } else if (!stoppedEarly) {
    skippedCritics.push({ model: 'gemini', reason: 'Gemini unavailable' });
  }

  // F-1 step 11: Parse final defender output to extract both documents
  const parseResult = parseSpecReviewResponse(currentDoc, delimiters);

  const refinedAppSpecSection = parseResult.updatedAppSpecSection || validInput.appSpecSection;
  const refinedTestSpec = parseResult.updatedTestSpec || validInput.testSpec;

  // Compute cross-document report (AD-4: post-processing)
  const crossDocumentReport = computeCrossDocumentReport(refinedAppSpecSection, refinedTestSpec);

  // D7: Enforce CDR consensus gates post-hoc
  let cdrGateFailed = false;
  const cdrFailures: string[] = [];

  if (crossDocumentReport.alignmentScore < 0.90) {
    cdrGateFailed = true;
    cdrFailures.push(`alignmentScore ${crossDocumentReport.alignmentScore.toFixed(4)} < 0.90`);
  }

  const stringMismatches = crossDocumentReport.mismatches.filter(m => m.type === 'string_mismatch').length;
  if (stringMismatches > 0) {
    cdrGateFailed = true;
    cdrFailures.push(`${stringMismatches} string mismatch(es) remain`);
  }

  const untestedBehaviors = crossDocumentReport.coverageMatrix.appSpecBehaviors - crossDocumentReport.coverageMatrix.testedBehaviors;
  if (untestedBehaviors > 0) {
    cdrGateFailed = true;
    cdrFailures.push(`${untestedBehaviors} untested behavior(s)`);
  }

  const allDebatesConsensus = Object.values(debates).every(d => d && (d as any).outcome === 'consensus');

  // D7: If debate said "complete" but CDR gates fail, downgrade to consensus_failed
  let finalStatus: JobStatus;
  if (cdrGateFailed) {
    finalStatus = 'consensus_failed';
    logger.logInfo('CDR gates failed, downgrading to consensus_failed', { jobId, cdrFailures });
  } else {
    finalStatus = allDebatesConsensus ? 'complete' : 'consensus_failed';
  }

  const consensusReached = finalStatus === 'complete';

  const tokenCounts = costTracker.getTokenCountByModel();
  const totalTokens = tokenCounts.claude + tokenCounts.chatgpt + tokenCounts.gemini;

  // D1: Build issuesFound breakdown from changelog and crossDocumentReport
  const changelogEntries = changelog.getChangelog();
  const issuesFound = computeIssuesFound(changelogEntries, crossDocumentReport);
  const totalIssuesFound = issuesFound.appSpecSection.buildability +
    issuesFound.appSpecSection.completeness +
    issuesFound.appSpecSection.ambiguity +
    issuesFound.appSpecSection.consistency +
    issuesFound.testSpec.testability +
    issuesFound.testSpec.coverageGaps +
    issuesFound.testSpec.testQuality +
    issuesFound.testSpec.specAlignment +
    issuesFound.crossDocument.orphanedTests +
    issuesFound.crossDocument.untestedBehavior +
    issuesFound.crossDocument.stringMismatches +
    issuesFound.crossDocument.attributeMismatches +
    issuesFound.crossDocument.implicitDependencies +
    issuesFound.crossDocument.missingPrerequisites;

  // Resolved = changelog entries that are not reverts and have no revertedChange pointer
  const totalIssuesResolved = changelogEntries.filter(c => c.type !== 'revert' && !c.revertedChange).length;
  const unresolvedIssues = Math.max(0, totalIssuesFound - totalIssuesResolved);

  // Helper to extract rounds from DebateSummary or DebateTranscript
  const getRounds = (d: (typeof debates)[keyof typeof debates]): number => {
    if (!d) return 0;
    if ('rounds' in d) return (d as import('../types/index.js').DebateSummary).rounds;
    if ('summary' in d) return (d as import('../types/index.js').DebateTranscript).summary.rounds;
    return 0;
  };

  // D1: Build OutputSummary
  const summary: OutputSummary = {
    totalRounds,
    chatgptRounds: getRounds(debates.chatgpt),
    geminiRounds: getRounds(debates.gemini),
    consensusReached,
    totalTokens,
    estimatedCost: costTracker.getEstimatedCostRounded(),
    issuesFound,
    totalIssuesFound,
    totalIssuesResolved,
    unresolvedIssues,
  };

  const output: BuildSpecReviewOutput = {
    jobId,
    jobType: 'build_spec_review',
    refinedAppSpecSection,
    refinedTestSpec,
    crossDocumentReport,
    changelog: changelogEntries,
    debates,
    summary,
    // D4: persist status and consensusReached for disk retrieval
    status: finalStatus,
    consensusReached,
  };

  jobStore.complete(jobId, output, finalStatus);

  logger.logJobCompleted(jobId, {
    rounds: totalRounds,
    cost: costTracker.getEstimatedCostRounded(),
    outcome: finalStatus,
  });

  // S-1: Strip webhookSecret before disk save
  const outputForDisk = { ...output } as any;
  delete outputForDisk.webhookSecret;

  try {
    await saveJobToDisk(jobId, outputForDisk as any);
    logger.logInfo('Spec review job auto-saved to disk', { jobId });
  } catch (error) {
    logger.logWarn('Failed to auto-save spec review job to disk', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
  }
}
