// ============================================================================
// Consensus Detection - Quantitative thresholds per PRD v3.0
// ============================================================================

import type { ConsensusResult, StructuredApproval } from '../types/index.js';
import { getUndefinedTerms } from '../utils/research.js';

// Exact approval phrases (per PRD v3.0 consensus criteria #5)
const APPROVAL_PHRASES = [
  'I have no further concerns with this PRD.',
  'I have no further concerns with this PRD',
  'This PRD is ready for implementation.',
  'This PRD is ready for implementation',
  'CONSENSUS_REACHED',
  'No further concerns. PRD approved.', // Legacy v2.6 phrase
];

// Minimum rounds required (Threshold #1)
const MIN_ROUNDS_REQUIRED = 2;

// Max new issues allowed in final round for declining rate (Threshold #4)
const MAX_NEW_ISSUES_FINAL_ROUND = 3;

/**
 * Detect consensus using PRD v3.0 quantitative thresholds
 *
 * Note: This function only checks Threshold #5 (explicit approval phrase).
 * The full consensus check requires additional context (current round, PRD content, etc.)
 * and is performed by checkFullConsensus() below.
 */
export function detectConsensus(response: string): ConsensusResult {
  const trimmed = response.trim();

  // Threshold #5: Check for exact approval phrase match
  const hasApprovalPhrase = APPROVAL_PHRASES.some(phrase => {
    // Case-insensitive, allows for trailing punctuation
    const pattern = new RegExp(phrase.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    return pattern.test(trimmed);
  });

  if (hasApprovalPhrase) {
    return {
      isConsensus: true,
      isConditional: false,
      isMalformed: false,
    };
  }

  // Try to parse structured JSON approval
  const jsonResult = tryParseStructuredApproval(trimmed);
  if (jsonResult) {
    if (jsonResult.approved && jsonResult.remainingConcerns.length === 0) {
      return {
        isConsensus: true,
        isConditional: false,
        isMalformed: false,
      };
    }

    // Has approval flag but with concerns = conditional
    if (jsonResult.approved && jsonResult.remainingConcerns.length > 0) {
      return {
        isConsensus: false,
        isConditional: true,
        condition: jsonResult.remainingConcerns.join('; '),
        isMalformed: false,
      };
    }

    // Explicitly not approved
    return {
      isConsensus: false,
      isConditional: false,
      isMalformed: false,
    };
  }

  // Check for conditional approval patterns
  const conditionalResult = detectConditionalApproval(trimmed);
  if (conditionalResult.isConditional) {
    return conditionalResult;
  }

  // No consensus, not malformed (regular feedback)
  return {
    isConsensus: false,
    isConditional: false,
    isMalformed: false,
  };
}

/**
 * Full consensus check with all 5 quantitative thresholds (PRD v3.0)
 *
 * Thresholds:
 * 1. Minimum 2 rounds completed
 * 2. Zero blocking issues (undefined terms, contradictions, etc.)
 * 3. Terminology 100% complete
 * 4. Declining rate (< 3 new issues this round)
 * 5. Explicit approval phrase
 */
export interface FullConsensusContext {
  currentRound: number;
  currentPrd: string;
  critiqueResponse: string;
  newIssuesThisRound: number;
  previousIssuesCount?: number;
}

export function checkFullConsensus(context: FullConsensusContext): {
  consensusReached: boolean;
  failedThresholds: string[];
  details: Record<string, any>;
} {
  const failedThresholds: string[] = [];
  const details: Record<string, any> = {};

  // Threshold #1: Minimum rounds requirement
  if (context.currentRound < MIN_ROUNDS_REQUIRED) {
    failedThresholds.push('minimum_rounds');
    details.currentRound = context.currentRound;
    details.minRequired = MIN_ROUNDS_REQUIRED;
  }

  // Threshold #2: Zero blocking issues
  const blockingIssues = extractBlockingIssues(context.critiqueResponse);
  if (blockingIssues.length > 0) {
    failedThresholds.push('blocking_issues');
    details.blockingIssues = blockingIssues;
  }

  // Threshold #3: Terminology completeness (100%)
  const undefinedTerms = getUndefinedTerms(context.currentPrd);
  if (undefinedTerms.length > 0) {
    failedThresholds.push('undefined_terms');
    details.undefinedTerms = undefinedTerms;
  }

  // Threshold #4: Declining rate (< 3 new issues)
  if (context.newIssuesThisRound >= MAX_NEW_ISSUES_FINAL_ROUND) {
    failedThresholds.push('declining_rate');
    details.newIssuesThisRound = context.newIssuesThisRound;
    details.maxAllowed = MAX_NEW_ISSUES_FINAL_ROUND - 1;
  }

  // Threshold #5: Explicit approval phrase
  const consensusResult = detectConsensus(context.critiqueResponse);
  if (!consensusResult.isConsensus) {
    failedThresholds.push('approval_phrase');
    details.hasApprovalPhrase = false;
  }

  const consensusReached = failedThresholds.length === 0;

  return {
    consensusReached,
    failedThresholds,
    details,
  };
}

/**
 * Extract blocking issues from critique response
 * Blocking issues include:
 * - Undefined terms or acronyms
 * - Logical contradictions
 * - Missing error handling
 * - Ambiguous acceptance criteria
 */
function extractBlockingIssues(response: string): string[] {
  const issues: string[] = [];

  // Look for explicit blocking issue indicators
  const blockingPatterns = [
    /undefined.*?term/i,
    /missing.*?definition/i,
    /contradiction/i,
    /inconsistent/i,
    /ambiguous.*?criteria/i,
    /unclear.*?requirement/i,
    /not defined/i,
  ];

  for (const pattern of blockingPatterns) {
    if (pattern.test(response)) {
      // Extract the sentence containing the issue
      const sentences = response.split(/[.!?]+/);
      for (const sentence of sentences) {
        if (pattern.test(sentence)) {
          issues.push(sentence.trim());
        }
      }
    }
  }

  return issues;
}

function tryParseStructuredApproval(response: string): StructuredApproval | null {
  // Look for JSON block in response
  const jsonMatch = response.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const jsonContent = jsonMatch ? jsonMatch[1] : response;

  // Try to find a JSON object in the content
  const objectMatch = jsonContent.match(/\{[\s\S]*"approved"[\s\S]*\}/);
  if (!objectMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(objectMatch[0]);

    // Validate schema
    if (typeof parsed.approved !== 'boolean') {
      return null;
    }

    if (!Array.isArray(parsed.remainingConcerns)) {
      return null;
    }

    // Validate all concerns are strings
    if (!parsed.remainingConcerns.every((c: unknown) => typeof c === 'string')) {
      return null;
    }

    return {
      approved: parsed.approved,
      remainingConcerns: parsed.remainingConcerns,
    };
  } catch {
    return null;
  }
}

function detectConditionalApproval(response: string): ConsensusResult {
  // Common conditional approval patterns
  const conditionalPatterns = [
    /approved?\s+(?:if|provided|assuming|once|when)\s+(.+)/i,
    /(?:lgtm|looks good)\s+(?:if|provided|assuming|once|when)\s+(.+)/i,
    /conditional(?:ly)?\s+approved?[:\s]+(.+)/i,
    /will\s+approve\s+(?:if|once|when)\s+(.+)/i,
  ];

  for (const pattern of conditionalPatterns) {
    const match = response.match(pattern);
    if (match) {
      return {
        isConsensus: false,
        isConditional: true,
        condition: match[1].trim(),
        isMalformed: false,
      };
    }
  }

  return {
    isConsensus: false,
    isConditional: false,
    isMalformed: false,
  };
}

export function isMalformedResponse(response: string): boolean {
  const trimmed = response.trim();

  // Empty or very short responses
  if (trimmed.length < 10) {
    return true;
  }

  // Contains obvious error indicators
  if (
    trimmed.includes('I apologize') &&
    trimmed.includes('error') &&
    trimmed.length < 200
  ) {
    return true;
  }

  // Garbled text detection (high ratio of non-printable characters)
  const printableRatio =
    trimmed.replace(/[^\x20-\x7E\n\r\t]/g, '').length / trimmed.length;
  if (printableRatio < 0.8) {
    return true;
  }

  return false;
}

export function extractUnresolvedConcerns(response: string): string[] {
  const concerns: string[] = [];

  // Try structured JSON first
  const structured = tryParseStructuredApproval(response);
  if (structured && structured.remainingConcerns.length > 0) {
    return structured.remainingConcerns;
  }

  // Look for bullet points or numbered lists of concerns
  const bulletPattern = /[-•*]\s*(.+)/g;
  const numberedPattern = /\d+[.)]\s*(.+)/g;

  let match;
  while ((match = bulletPattern.exec(response)) !== null) {
    const concern = match[1].trim();
    if (concern.length > 10 && !concern.toLowerCase().includes('approved')) {
      concerns.push(concern);
    }
  }

  while ((match = numberedPattern.exec(response)) !== null) {
    const concern = match[1].trim();
    if (
      concern.length > 10 &&
      !concern.toLowerCase().includes('approved') &&
      !concerns.includes(concern)
    ) {
      concerns.push(concern);
    }
  }

  return concerns;
}
