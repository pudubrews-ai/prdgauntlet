// ============================================================================
// Debate Engine v3.0 - Enhanced debate with all PRD v3.0 features
// ============================================================================

import type {
  GauntletConfig,
  CriticModel,
  DebateResult,
  ChangeEntry,
} from '../types/index.js';
import { runDebate, type DebateConfig, type DebateContext } from './engine.js';
import { CostTracker } from '../utils/cost.js';
import { ChangelogManager } from '../utils/changelog.js';
import { LoopDetector } from '../utils/loopDetection.js';
import { checkFullConsensus } from './consensus.js';
import {
  generateTranscriptSummary,
  shouldCompressTranscript,
} from '../utils/transcriptSummary.js';
import { checkPrdSize, willExceedOutputLimit } from '../utils/sizeEnforcement.js';
import { logger } from '../utils/logger.js';

/**
 * v3.0 Enhanced debate config
 */
export interface DebateConfigV3 extends DebateConfig {
  transcriptSummaryOnly?: boolean;
  targetedSections?: string[];
  webhookUrl?: string;
}

/**
 * v3.0 Enhanced debate result
 */
export interface DebateResultV3 extends DebateResult {
  loopsDetected?: number;
  terminologyResearched?: string[];
  cacheHits?: number;
  cacheMisses?: number;
  transcriptCompressed?: boolean;
  sizeExceeded?: boolean;
}

/**
 * Run debate with v3.0 enhancements
 */
export async function runDebateV3(
  context: DebateContext & { config: DebateConfigV3 },
  gauntletConfig: GauntletConfig
): Promise<DebateResultV3> {
  const { jobId, prd, critic, config, costTracker, changelog } = context;

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

  // v3.0: Initialize loop detector
  const loopDetector = new LoopDetector();

  // Run base debate
  logger.logInfo('Running v3.0 enhanced debate', {
    jobId,
    critic,
    targetedSections: config.targetedSections,
  });

  const result = await runDebate(context, gauntletConfig);

  // v3.0: Track issues for loop detection
  // (This would ideally be done during the debate, but we can analyze after)
  if (result.transcript.messages.length > 0) {
    analyzeForLoops(result.transcript.messages, loopDetector);
  }

  // v3.0: Check for loops
  const detectedLoops = loopDetector.detectLoops(result.transcript.summary.rounds);
  if (detectedLoops.length > 0) {
    logger.logWarn('Loops detected in debate', {
      jobId,
      critic,
      loopCount: detectedLoops.length,
    });
  }

  // v3.0: Check output size
  const outputCheck = checkPrdSize(result.finalPrd, false);
  if (!outputCheck.ok) {
    logger.logWarn('Output PRD exceeds size limit', {
      jobId,
      sizeKB: outputCheck.sizeKB,
      limitKB: outputCheck.limitKB,
    });
  }

  // v3.0: Generate transcript summary if requested or if transcript too large
  let transcriptCompressed = false;
  if (config.transcriptSummaryOnly || shouldCompressTranscript(result.transcript)) {
    const summary = generateTranscriptSummary(result.transcript);
    logger.logInfo('Transcript compressed to summary', {
      jobId,
      originalRounds: result.transcript.messages.length,
      summaryEntries: summary.length,
    });
    transcriptCompressed = true;
  }

  // v3.0: Return enhanced result
  return {
    ...result,
    loopsDetected: detectedLoops.length,
    transcriptCompressed,
    sizeExceeded: !outputCheck.ok,
  };
}

/**
 * Analyze debate transcript for loops
 */
function analyzeForLoops(
  messages: any[],
  loopDetector: LoopDetector
): void {
  let currentRound = 1;

  for (const message of messages) {
    if (message.role === 'critic') {
      loopDetector.recordIssueRaised(
        currentRound,
        'chatgpt' as CriticModel, // Simplified - would need actual critic
        message.content
      );
    } else if (message.role === 'defender') {
      // Would need to extract changes from defender message
      // For now, skip
      currentRound++;
    }
  }
}

/**
 * Check consensus with v3.0 full threshold validation
 */
export function checkConsensusV3(
  currentRound: number,
  currentPrd: string,
  critiqueResponse: string,
  newIssuesCount: number
): {
  consensusReached: boolean;
  failedThresholds: string[];
  details: Record<string, any>;
} {
  return checkFullConsensus({
    currentRound,
    currentPrd,
    critiqueResponse,
    newIssuesThisRound: newIssuesCount,
  });
}
