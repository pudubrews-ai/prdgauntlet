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

/**
 * Bug 3 (S6): Strip JSON code blocks ONLY within a "## Changes This Round" section.
 * Uses section-header anchoring — never content-shape heuristics.
 * Preserves ALL code blocks outside that section (e.g., API response shape examples).
 *
 * Also handles ### Changes This Round (h3 variant).
 */
function stripRoundDeltaBlocks(content: string): string {
  // Match: ## Changes This Round ... (up to next ##-level header, or end of string)
  const sectionPattern = /(##[#]?\s*Changes\s+This\s+Round[\s\S]*?)(?=\n##[^#]|\n$|$)/gi;
  const allMatches = [...content.matchAll(sectionPattern)];
  if (allMatches.length === 0) return content; // No section found — preserve everything
  const match = allMatches[allMatches.length - 1]; // Take the LAST occurrence
  if (match.index === undefined) return content;

  const sectionStart = match.index;
  const sectionEnd = sectionStart + match[0].length;
  const before = content.slice(0, sectionStart);
  const section = content.slice(sectionStart, sectionEnd);
  const after = content.slice(sectionEnd);

  // Strip json code blocks only within the matched section
  const cleaned = section.replace(/```json[\s\S]*?```/g, '');
  // Strip the heading itself if the section is now empty
  const trimmedSection = cleaned.replace(/##[#]?\s*Changes\s+This\s+Round\s*/i, '').trim();

  return (before + (trimmedSection ? '\n' + trimmedSection + '\n' : '') + after).trim();
}

function extractUpdatedPrd(content: string): string | null {
  // Look for ## Updated PRD section
  // Note: The PRD content may contain its own ## headers, so we need to look for
  // the specific end markers (## Changes This Round or ## Question for Critic)
  // rather than any ## header
  const prdMatch = content.match(/## Updated PRD\s*\n([\s\S]*?)(?=\n## Changes This Round|\n## Question for Critic|\n---END RESPONSE---|$)/);
  if (prdMatch) {
    return prdMatch[1].trim();
  }

  // Fallback: if no explicit section, but content looks like a PRD, return it
  // This handles cases where the defender might format differently
  if (content.includes('# ') && content.length > 500) {
    // Bug 3 (S6): Only strip JSON code blocks that appear within a
    // "## Changes This Round" section — NOT blocks elsewhere in the document
    // (e.g., API response shape examples with "type"/"summary" keys).
    const withoutRoundDelta = stripRoundDeltaBlocks(content);

    // Remove any remaining "Changes This Round" or "Question for Critic" sections
    const cleaned = withoutRoundDelta
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
  const allChanges = [...content.matchAll(/## Changes This Round\s*\n([\s\S]*?)(?=\n## |$)/g)];
  const changesSection = allChanges.length > 0 ? allChanges[allChanges.length - 1] : null;

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
    type === 'revert' ||
    type === 'no_change'
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
