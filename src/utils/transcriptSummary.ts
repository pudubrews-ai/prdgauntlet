// ============================================================================
// Transcript Summary - Condensed transcript generation (PRD v3.0)
// ============================================================================

import type { DebateTranscript, DebateMessage } from '../types/index.js';
import { logger } from './logger.js';

export interface TranscriptSummaryEntry {
  round: number;
  timestamp: string;
  keyCritiquePoints: string; // Max 500 chars
  consensusReached: boolean;
  changesSummary: string; // Diff summary
}

/**
 * Generate condensed transcript summary (2-5KB vs 10-50KB full transcript)
 */
export function generateTranscriptSummary(
  transcript: DebateTranscript
): TranscriptSummaryEntry[] {
  const summaries: TranscriptSummaryEntry[] = [];

  // Group messages by round
  const messagesByRound = groupMessagesByRound(transcript.messages);

  for (const [round, messages] of messagesByRound.entries()) {
    const critiqueMsg = messages.find(m => m.role === 'critic');
    const defenderMsg = messages.find(m => m.role === 'defender');

    if (!critiqueMsg) continue;

    // Extract key critique points (max 500 chars)
    const keyCritiquePoints = extractKeyPoints(
      critiqueMsg.content,
      500
    );

    // Extract changes summary from defender response
    const changesSummary = defenderMsg
      ? extractChangesSummary(defenderMsg.content)
      : 'No changes';

    // Check if consensus was reached in this round
    const consensusReached =
      critiqueMsg.content.includes('I have no further concerns') ||
      critiqueMsg.content.includes('CONSENSUS_REACHED') ||
      critiqueMsg.content.includes('PRD approved');

    summaries.push({
      round,
      timestamp: critiqueMsg.timestamp,
      keyCritiquePoints,
      consensusReached,
      changesSummary,
    });
  }

  const estimatedSize = JSON.stringify(summaries).length;
  logger.logDebug('Transcript summary generated', {
    rounds: summaries.length,
    estimatedSizeKB: (estimatedSize / 1024).toFixed(1),
  });

  return summaries;
}

/**
 * Group messages by round number
 */
function groupMessagesByRound(
  messages: DebateMessage[]
): Map<number, DebateMessage[]> {
  const byRound = new Map<number, DebateMessage[]>();

  // Assume alternating critic/defender pattern
  let currentRound = 1;

  for (const message of messages) {
    if (message.role === 'critic') {
      // Start new round
      if (!byRound.has(currentRound)) {
        byRound.set(currentRound, []);
      }
    }

    const roundMessages = byRound.get(currentRound) || [];
    roundMessages.push(message);
    byRound.set(currentRound, roundMessages);

    // Move to next round after defender responds
    if (message.role === 'defender') {
      currentRound++;
    }
  }

  return byRound;
}

/**
 * Extract key points from critique (condensed to maxChars)
 */
function extractKeyPoints(critique: string, maxChars: number): string {
  // Extract bullet points or numbered items
  const lines = critique.split('\n');
  const keyPoints: string[] = [];

  for (const line of lines) {
    const bulletMatch = line.match(/^[\s]*[-*•]\s+(.+)/);
    const numberedMatch = line.match(/^\d+[.)]\s+(.+)/);

    if (bulletMatch || numberedMatch) {
      const point = (bulletMatch?.[1] || numberedMatch?.[1] || '').trim();
      if (point.length > 0) {
        keyPoints.push(point);
      }
    }
  }

  // If no bullets, extract first few sentences
  if (keyPoints.length === 0) {
    const sentences = critique.split(/[.!?]+/).filter(s => s.trim().length > 10);
    keyPoints.push(...sentences.slice(0, 3).map(s => s.trim()));
  }

  // Join and truncate to maxChars
  let summary = keyPoints.join('; ');
  if (summary.length > maxChars) {
    summary = summary.substring(0, maxChars - 3) + '...';
  }

  return summary || 'No specific critique points extracted';
}

/**
 * Extract changes summary from defender response
 */
function extractChangesSummary(defenderResponse: string): string {
  // Look for "## Changes This Round" section
  const changesMatch = defenderResponse.match(
    /##\s+Changes This Round([\s\S]*?)(?=\n##|$)/i
  );

  if (changesMatch) {
    const changesSection = changesMatch[1].trim();

    // Try to parse JSON if present
    const jsonMatch = changesSection.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
    if (jsonMatch) {
      try {
        const changeObj = JSON.parse(jsonMatch[1]);
        return `${changeObj.type}: ${changeObj.summary}`;
      } catch {
        // Fall through to text extraction
      }
    }

    // Extract first line of changes
    const firstLine = changesSection.split('\n')[0];
    return firstLine.substring(0, 200);
  }

  return 'Changes not specified';
}

/**
 * Check if transcript should be compressed due to size
 */
export function shouldCompressTranscript(transcript: DebateTranscript): boolean {
  const estimatedSize = JSON.stringify(transcript).length;
  const MAX_SIZE = 10 * 1024 * 1024; // 10MB

  return estimatedSize > MAX_SIZE;
}

/**
 * Estimate transcript size
 */
export function estimateTranscriptSize(transcript: DebateTranscript): number {
  return JSON.stringify(transcript).length;
}
