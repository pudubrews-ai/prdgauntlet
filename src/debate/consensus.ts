// ============================================================================
// Consensus Detection - Exact match per FR5
// ============================================================================

import type { ConsensusResult, StructuredApproval } from '../types/index.js';

// Exact approval phrase (no fuzzy matching)
const APPROVAL_PHRASE = 'No further concerns. PRD approved.';

export function detectConsensus(response: string): ConsensusResult {
  const trimmed = response.trim();

  // Check for exact phrase match
  if (trimmed === APPROVAL_PHRASE || trimmed.includes(APPROVAL_PHRASE)) {
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
