// ============================================================================
// Response Parser - Extract PRD and round delta from defender responses
// ============================================================================

import type { RoundDelta, ChangeType } from '../types/index.js';

export interface ParsedDefenderResponse {
  updatedPrd: string | null;
  roundDelta: RoundDelta | null;
  isConsensusReached: boolean;
  rawResponse: string;
  parseError?: string;
}

const CONSENSUS_SIGNAL = 'CONSENSUS_REACHED';
const BEGIN_MARKER = '---BEGIN RESPONSE---';
const END_MARKER = '---END RESPONSE---';

export function parseDefenderResponse(response: string): ParsedDefenderResponse {
  const trimmed = response.trim();

  // Check for consensus signal
  if (trimmed === CONSENSUS_SIGNAL || trimmed.endsWith(CONSENSUS_SIGNAL)) {
    return {
      updatedPrd: null,
      roundDelta: null,
      isConsensusReached: true,
      rawResponse: response,
    };
  }

  // Extract content between markers
  let content = trimmed;
  const beginIdx = trimmed.indexOf(BEGIN_MARKER);
  const endIdx = trimmed.indexOf(END_MARKER);

  if (beginIdx !== -1 && endIdx !== -1 && endIdx > beginIdx) {
    content = trimmed.substring(beginIdx + BEGIN_MARKER.length, endIdx).trim();
  } else if (beginIdx !== -1) {
    content = trimmed.substring(beginIdx + BEGIN_MARKER.length).trim();
  }

  // Extract updated PRD
  const updatedPrd = extractUpdatedPrd(content);

  // Extract round delta JSON
  const roundDelta = extractRoundDelta(content);

  return {
    updatedPrd,
    roundDelta,
    isConsensusReached: false,
    rawResponse: response,
    parseError: !updatedPrd && !roundDelta ? 'Could not parse defender response' : undefined,
  };
}

function extractUpdatedPrd(content: string): string | null {
  // Look for ## Updated PRD section
  const prdMatch = content.match(/## Updated PRD\s*\n([\s\S]*?)(?=\n## |\n---|\n```json|$)/);
  if (prdMatch) {
    return prdMatch[1].trim();
  }

  // Fallback: if no explicit section, but content looks like a PRD, return it
  // This handles cases where the defender might format differently
  if (content.includes('# ') && content.length > 500) {
    // Likely contains markdown headers, could be a PRD
    const jsonBlockPattern = /```json[\s\S]*?```/g;
    const withoutJson = content.replace(jsonBlockPattern, '').trim();

    // Remove any "Changes This Round" or "Question for Critic" sections
    const cleaned = withoutJson
      .replace(/## Changes This Round[\s\S]*?(?=\n## |$)/g, '')
      .replace(/## Question for Critic[\s\S]*/g, '')
      .trim();

    if (cleaned.length > 200) {
      return cleaned;
    }
  }

  return null;
}

function extractRoundDelta(content: string): RoundDelta | null {
  // Look for JSON in Changes This Round section
  const changesSection = content.match(/## Changes This Round\s*\n([\s\S]*?)(?=\n## |$)/);

  if (!changesSection) {
    // Try to find any JSON block
    return extractJsonFromContent(content);
  }

  const sectionContent = changesSection[1];
  return extractJsonFromContent(sectionContent);
}

function extractJsonFromContent(content: string): RoundDelta | null {
  // Look for JSON code block
  const jsonBlockMatch = content.match(/```(?:json)?\s*(\{[\s\S]*?\})\s*```/);
  const jsonContent = jsonBlockMatch ? jsonBlockMatch[1] : content;

  // Try to find a JSON object
  const objectMatch = jsonContent.match(/\{[\s\S]*?"type"[\s\S]*?\}/);
  if (!objectMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(objectMatch[0]);

    // Validate required fields
    if (!isValidChangeType(parsed.type)) {
      return null;
    }

    if (typeof parsed.summary !== 'string') {
      return null;
    }

    return {
      type: parsed.type as ChangeType,
      summary: parsed.summary,
      section: typeof parsed.section === 'string' ? parsed.section : undefined,
    };
  } catch {
    return null;
  }
}

function isValidChangeType(type: unknown): type is ChangeType {
  return (
    type === 'addition' ||
    type === 'modification' ||
    type === 'deletion' ||
    type === 'revert'
  );
}

export function extractDefenderQuestion(response: string): string | null {
  const questionMatch = response.match(/## Question for Critic\s*\n([\s\S]*?)(?=\n---|$)/);
  if (questionMatch) {
    return questionMatch[1].trim();
  }
  return null;
}

export function isRequestingClarification(response: string): boolean {
  const clarificationPatterns = [
    /couldn't parse/i,
    /please restate/i,
    /clarify your/i,
    /unclear feedback/i,
    /malformed/i,
  ];

  return clarificationPatterns.some((pattern) => pattern.test(response));
}
