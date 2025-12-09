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
import { detectConsensus, isMalformedResponse, extractUnresolvedConcerns } from './consensus.js';
import { parseDefenderResponse, isRequestingClarification } from './parser.js';

export interface DebateConfig {
  maxRounds: number;
  maxTotalTokens?: number;
  maxEstimatedCost?: number;
  retryOnTimeout: boolean;
  metadata?: CriticPromptMetadata;
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

  // Conversation history for each participant
  const defenderHistory: LLMMessage[] = [];
  const criticHistory: LLMMessage[] = [];

  // Initial defender message
  const initialDefenderContent = formatInitialDefenderMessage(currentPrd, previousChangelog);
  defenderHistory.push({ role: 'user', content: initialDefenderContent });

  // Initial critic review
  const initialCriticContent = formatCriticReviewMessage(currentPrd, previousChangelog);
  criticHistory.push({ role: 'user', content: initialCriticContent });

  logger.logDebug(`Starting ${critic} debate`, { jobId, maxRounds: config.maxRounds });

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

      // Check for consensus
      const consensusResult = detectConsensus(criticResponse.content);
      if (consensusResult.isConsensus) {
        logger.logConsensusReached(jobId, critic, round);
        outcome = 'consensus';
        break;
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

      if (parsed.isConsensusReached) {
        logger.logConsensusReached(jobId, critic, round);
        outcome = 'consensus';
        break;
      }

      // Update PRD if we got one
      if (parsed.updatedPrd) {
        currentPrd = parsed.updatedPrd;
      }

      // Track changes
      if (parsed.roundDelta) {
        const entry = changelog.addChange(parsed.roundDelta, critic, round);
        changes.push(entry);
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
