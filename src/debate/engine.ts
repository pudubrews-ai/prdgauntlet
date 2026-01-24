// ============================================================================
// Debate Engine - Core debate loop orchestration (FR4)
// ============================================================================

import type {
  GauntletConfig,
  CriticModel,
  DebateResult,
  DebateMessage,
  DebateTranscript,
  ChangeEntry,
  LLMMessage,
  LLMClient,
} from '../types/index.js';
import { ClaudeClient } from '../clients/claude.js';
import { OpenAIClient } from '../clients/openai.js';
import { GeminiClient } from '../clients/gemini.js';
import { CostTracker } from '../utils/cost.js';
import { ChangelogManager } from '../utils/changelog.js';
import { logger } from '../utils/logger.js';
import {
  buildDefenderPrompt,
  formatInitialDefenderMessage,
  formatDefenderRoundMessage,
} from '../prompts/defender.js';
import {
  buildCriticPrompt,
  formatCriticReviewMessage,
  formatCriticFollowUpMessage,
  type CriticPromptMetadata,
} from '../prompts/critic.js';
import {
  detectConsensus,
  isMalformedResponse,
  extractUnresolvedConcerns,
  checkFullConsensus,
} from './consensus.js';
import { parseDefenderResponse, isRequestingClarification } from './parser.js';
import { LoopDetector } from '../utils/loopDetection.js';
import { checkPrdSize, willExceedOutputLimit } from '../utils/sizeEnforcement.js';
import {
  generateTranscriptSummary,
  shouldCompressTranscript,
} from '../utils/transcriptSummary.js';

export interface DebateConfig {
  maxRounds: number;
  maxTotalTokens?: number;
  maxEstimatedCost?: number;
  retryOnTimeout: boolean;
  metadata?: CriticPromptMetadata;
  transcriptSummaryOnly?: boolean; // v3.0: Return condensed 2-5KB summary instead of full transcript
  targetedSections?: string[]; // v3.0: Section paths for targeted re-debate
  useFullConsensus?: boolean; // v3.0: Use 5-threshold consensus validation
}

export interface DebateContext {
  jobId: string;
  prd: string;
  critic: CriticModel;
  config: DebateConfig;
  costTracker: CostTracker;
  changelog: ChangelogManager;
  previousChangelog?: string;
}

export async function runDebate(
  context: DebateContext,
  gauntletConfig: GauntletConfig
): Promise<DebateResult> {
  const { jobId, prd, critic, config, costTracker, changelog, previousChangelog } = context;

  // v3.0: Check input size
  const inputCheck = checkPrdSize(prd, true);
  if (!inputCheck.ok) {
    logger.logError('Input PRD too large', {
      jobId,
      sizeKB: inputCheck.sizeKB,
      limitKB: inputCheck.limitKB,
    });
    throw new Error(inputCheck.error);
  }

  // Initialize clients with configurable timeout
  const defender = new ClaudeClient(
    gauntletConfig.anthropicApiKey,
    gauntletConfig.models.claude,
    gauntletConfig.apiTimeoutMs
  );
  const criticClient = createCriticClient(critic, gauntletConfig);

  // Build prompts
  const defenderPrompt = buildDefenderPrompt(gauntletConfig.prompts?.defender);
  const criticPrompt = buildCriticPrompt(config.metadata);

  // State
  let currentPrd = prd;
  let round = 0;
  let consecutiveMalformed = 0;
  const messages: DebateMessage[] = [];
  const changes: ChangeEntry[] = [];
  let outcome: 'consensus' | 'max_rounds' | 'early_stop' = 'max_rounds';
  let unresolvedConcerns: string[] = [];
  let totalDefenderTokens = 0;
  let totalCriticTokens = 0;

  // v3.0: Initialize loop detector
  const loopDetector = new LoopDetector();
  let newIssuesThisRound = 0;

  // FR7: Set initial PRD for diff tracking
  changelog.setInitialPrd(prd);

  // Conversation history for each participant
  const defenderHistory: LLMMessage[] = [];
  const criticHistory: LLMMessage[] = [];

  // Initial defender message
  const initialDefenderContent = formatInitialDefenderMessage(currentPrd, previousChangelog);
  defenderHistory.push({ role: 'user', content: initialDefenderContent });

  // Initial critic review
  const initialCriticContent = formatCriticReviewMessage(currentPrd, previousChangelog);
  criticHistory.push({ role: 'user', content: initialCriticContent });

  // TEMP: Use logInfo instead of logDebug to trace Gemini content bug
  logger.logInfo(`Starting ${critic} debate`, {
    jobId,
    maxRounds: config.maxRounds,
    prdLength: prd.length,
    currentPrdLength: currentPrd.length,
    initialCriticContentLength: initialCriticContent.length,
    previousChangelogLength: previousChangelog?.length ?? 0,
  });

  while (round < config.maxRounds) {
    round++;

    // Check caps before proceeding
    if (config.maxTotalTokens && costTracker.hasExceededTokenCap(config.maxTotalTokens)) {
      logger.logEarlyStop(jobId, 'token_cap', critic);
      outcome = 'early_stop';
      unresolvedConcerns = ['Token cap exceeded before completion'];
      break;
    }

    if (config.maxEstimatedCost && costTracker.hasExceededCostCap(config.maxEstimatedCost)) {
      logger.logEarlyStop(jobId, 'cost_cap', critic);
      outcome = 'early_stop';
      unresolvedConcerns = ['Cost cap exceeded before completion'];
      break;
    }

    // FR10: Check 80% cost threshold warning
    if (
      config.maxEstimatedCost &&
      costTracker.isApproaching80PercentCap(config.maxEstimatedCost)
    ) {
      logger.logCostThresholdWarning(
        jobId,
        costTracker.getCostWithSafetyMargin(),
        config.maxEstimatedCost
      );
    }

    try {
      // Step 1: Get critic feedback
      const criticResponse = await getCriticFeedback(
        criticClient,
        criticHistory,
        criticPrompt,
        config.retryOnTimeout
      );

      // Track tokens
      costTracker.addTokens(
        critic,
        criticResponse.usage.inputTokens,
        criticResponse.usage.outputTokens
      );
      totalCriticTokens += criticResponse.usage.inputTokens + criticResponse.usage.outputTokens;

      // Log message
      messages.push({
        role: 'critic',
        content: criticResponse.content,
        timestamp: new Date().toISOString(),
      });

      logger.logDebateRound(jobId, critic, round, {
        input: criticResponse.usage.inputTokens,
        output: criticResponse.usage.outputTokens,
      });

      // v3.0: Track issues for loop detection
      const issuesInResponse = extractUnresolvedConcerns(criticResponse.content);
      newIssuesThisRound = issuesInResponse.length;

      for (const issue of issuesInResponse) {
        loopDetector.recordIssueRaised(round, critic, issue);
      }

      // v3.0: Check for consensus using full 5-threshold validation if enabled
      if (config.useFullConsensus) {
        const fullConsensusCheck = checkFullConsensus({
          currentRound: round,
          currentPrd,
          critiqueResponse: criticResponse.content,
          newIssuesThisRound,
        });

        if (fullConsensusCheck.consensusReached) {
          logger.logConsensusReached(jobId, critic, round);
          logger.logInfo('v3.0 Full consensus validated', {
            jobId,
            round,
            details: fullConsensusCheck.details,
          });
          outcome = 'consensus';
          break;
        } else if (fullConsensusCheck.failedThresholds.length > 0) {
          logger.logDebug('Consensus thresholds not met', {
            jobId,
            round,
            failedThresholds: fullConsensusCheck.failedThresholds,
            details: fullConsensusCheck.details,
          });
        }
      } else {
        // Standard consensus detection (v2.6 compatibility)
        const consensusResult = detectConsensus(criticResponse.content);
        if (consensusResult.isConsensus) {
          logger.logConsensusReached(jobId, critic, round);
          outcome = 'consensus';
          break;
        }
      }

      // Check for malformed response
      if (isMalformedResponse(criticResponse.content)) {
        consecutiveMalformed++;
        logger.logMalformedResponse(jobId, critic, round, consecutiveMalformed);

        if (consecutiveMalformed >= 2) {
          logger.logWarn('Two consecutive malformed responses, continuing as non-approval', {
            jobId,
            model: critic,
          });
        }
      } else {
        consecutiveMalformed = 0;
      }

      // Extract concerns for tracking
      const extractedConcerns = extractUnresolvedConcerns(criticResponse.content);
      if (extractedConcerns.length > 0) {
        unresolvedConcerns = extractedConcerns;
      }

      // Update critic history
      criticHistory.push({ role: 'assistant', content: criticResponse.content });

      // Step 2: Get defender response
      const defenderInput = formatDefenderRoundMessage(criticResponse.content);
      defenderHistory.push({ role: 'user', content: defenderInput });

      const defenderResponse = await getDefenderResponse(
        defender,
        defenderHistory,
        defenderPrompt,
        config.retryOnTimeout
      );

      // Track tokens
      costTracker.addTokens(
        'claude',
        defenderResponse.usage.inputTokens,
        defenderResponse.usage.outputTokens
      );
      totalDefenderTokens +=
        defenderResponse.usage.inputTokens + defenderResponse.usage.outputTokens;

      // Log message
      messages.push({
        role: 'defender',
        content: defenderResponse.content,
        timestamp: new Date().toISOString(),
      });

      // Parse defender response
      const parsed = parseDefenderResponse(defenderResponse.content);

      // Log parse errors
      if (parsed.parseError) {
        logger.logWarn('Defender response parse error', {
          jobId,
          round,
          error: parsed.parseError,
          responseLength: defenderResponse.content.length,
        });
      }

      if (parsed.isConsensusReached) {
        logger.logConsensusReached(jobId, critic, round);
        outcome = 'consensus';
        break;
      }

      // CRITICAL: Defender must return updated PRD
      if (!parsed.updatedPrd && parsed.roundDelta) {
        // Defender returned changes but no PRD - this is a protocol violation
        logger.logError('Defender returned changes without updated PRD', {
          jobId,
          round,
          critic,
          hasRoundDelta: !!parsed.roundDelta,
          responsePreview: defenderResponse.content.substring(0, 200),
        });

        // This is a critical error - we cannot continue without the PRD
        outcome = 'early_stop';
        unresolvedConcerns = [
          `Round ${round}: Defender failed to return updated PRD. Protocol violation - cannot continue debate.`,
        ];
        break;
      }

      // Update PRD if we got one
      if (parsed.updatedPrd) {
        // v3.0: Check output size before accepting update
        const sizeCheck = willExceedOutputLimit(currentPrd, parsed.updatedPrd);
        if (sizeCheck.willExceed) {
          logger.logWarn('Output size limit would be exceeded, stopping at last complete round', {
            jobId,
            round,
            currentSizeKB: sizeCheck.currentSizeKB,
            estimatedSizeKB: sizeCheck.estimatedSizeKB,
            limitKB: sizeCheck.limitKB,
          });
          outcome = 'early_stop';
          unresolvedConcerns = [
            `Output PRD would exceed ${sizeCheck.limitKB}KB limit (estimated: ${sizeCheck.estimatedSizeKB.toFixed(1)}KB). Stopped at Round ${round - 1}.`,
          ];
          break;
        }

        currentPrd = parsed.updatedPrd;
      }

      // Track changes with diff generation
      if (parsed.roundDelta) {
        const entry = changelog.addChange(parsed.roundDelta, critic, round, undefined, currentPrd);
        changes.push(entry);

        // v3.0: Record changes for loop detection (using the entry)
        loopDetector.recordChanges(round, critic, [entry]);
      }

      // Update defender history
      defenderHistory.push({ role: 'assistant', content: defenderResponse.content });

      // Prepare next critic message
      const followUp = formatCriticFollowUpMessage(
        currentPrd,
        defenderResponse.content,
        changelog.getChangelogSummary()
      );
      criticHistory.push({ role: 'user', content: followUp });

      // Check if defender was requesting clarification (still counts as round)
      if (isRequestingClarification(defenderResponse.content)) {
        logger.logDebug('Defender requested clarification from critic', { jobId, round });
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.logProviderError(jobId, critic, message);

      // Check if it's a timeout
      if (message.includes('timeout')) {
        if (config.retryOnTimeout && round < config.maxRounds) {
          logger.logWarn('Retrying round after timeout', { jobId, round });
          round--; // Retry this round
          continue;
        }
      }

      outcome = 'early_stop';
      unresolvedConcerns = [`Provider error: ${message}`];
      break;
    }
  }

  // v3.0: Detect loops
  const detectedLoops = loopDetector.detectLoops(round);
  if (detectedLoops.length > 0) {
    logger.logWarn('Loops detected in debate', {
      jobId,
      critic,
      loopCount: detectedLoops.length,
      loops: detectedLoops.map((l) => ({
        issue: l.issue,
        roundsInvolved: l.timeline.map((t) => t.round),
      })),
    });
  }

  // Build transcript
  const transcript: DebateTranscript = {
    summary: {
      rounds: round,
      outcome,
      keyChanges: changes.map((c) => c.summary),
      unresolvedConcerns: unresolvedConcerns.length > 0 ? unresolvedConcerns : undefined,
    },
    messages,
  };

  // v3.0: Generate transcript summary if requested or if too large
  let transcriptCompressed = false;
  if (config.transcriptSummaryOnly || shouldCompressTranscript(transcript)) {
    const summary = generateTranscriptSummary(transcript);
    logger.logInfo('Transcript compressed to summary', {
      jobId,
      originalMessages: transcript.messages.length,
      summaryEntries: summary.length,
    });
    transcriptCompressed = true;

    // Replace messages with summary (convert to message format)
    transcript.messages = summary.map((entry) => ({
      role: 'summary' as any,
      content: `Round ${entry.round}: ${entry.keyCritiquePoints}. Changes: ${entry.changesSummary || 'None'}`,
      timestamp: entry.timestamp,
    }));
  }

  // v3.0: Final output size check
  const outputCheck = checkPrdSize(currentPrd, false);
  if (!outputCheck.ok) {
    logger.logWarn('Output PRD exceeds size limit', {
      jobId,
      sizeKB: outputCheck.sizeKB,
      limitKB: outputCheck.limitKB,
    });
  }

  // v3.0: Record job completion for rolling average
  costTracker.recordJobCompletion();

  return {
    finalPrd: currentPrd,
    transcript,
    changes,
    outcome,
    unresolvedConcerns,
    tokensUsed: {
      defender: totalDefenderTokens,
      critic: totalCriticTokens,
    },
    // v3.0 metadata
    loopsDetected: detectedLoops.length,
    transcriptCompressed,
    sizeExceeded: !outputCheck.ok,
  };
}

function createCriticClient(critic: CriticModel, config: GauntletConfig): LLMClient {
  if (critic === 'chatgpt') {
    return new OpenAIClient(config.openaiApiKey, config.models.chatgpt, config.apiTimeoutMs);
  } else {
    return new GeminiClient(config.googleApiKey, config.models.gemini, config.apiTimeoutMs);
  }
}

async function getCriticFeedback(
  client: LLMClient,
  history: LLMMessage[],
  systemPrompt: string,
  retryOnTimeout: boolean,
  retryCount = 0
): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> {
  try {
    return await client.chat(history, systemPrompt);
  } catch (error) {
    if (
      retryOnTimeout &&
      retryCount === 0 &&
      error instanceof Error &&
      error.message.includes('timeout')
    ) {
      return getCriticFeedback(client, history, systemPrompt, false, 1);
    }
    throw error;
  }
}

async function getDefenderResponse(
  client: ClaudeClient,
  history: LLMMessage[],
  systemPrompt: string,
  retryOnTimeout: boolean,
  retryCount = 0
): Promise<{ content: string; usage: { inputTokens: number; outputTokens: number } }> {
  try {
    return await client.chat(history, systemPrompt);
  } catch (error) {
    if (
      retryOnTimeout &&
      retryCount === 0 &&
      error instanceof Error &&
      error.message.includes('timeout')
    ) {
      return getDefenderResponse(client, history, systemPrompt, false, 1);
    }
    throw error;
  }
}
