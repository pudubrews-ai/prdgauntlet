// ============================================================================
// Diff Generation - Unified diff for changelog entries (FR7)
// ============================================================================

import { createPatch } from 'diff';

const CONTEXT_LINES = 3; // ±3 lines of context around changes
const MAX_DIFF_LINES = 500; // Truncate if diff exceeds this

/**
 * Generate a unified diff between two text versions.
 *
 * @param oldText - The original text
 * @param newText - The updated text
 * @param filename - Optional filename for diff header (default: 'PRD')
 * @returns Unified diff string, truncated if > 500 lines
 */
export function generateDiff(
  oldText: string,
  newText: string,
  filename: string = 'PRD'
): string {
  if (oldText === newText) {
    return ''; // No changes
  }

  try {
    const patch = createPatch(
      filename,
      oldText,
      newText,
      'previous',
      'current',
      { context: CONTEXT_LINES }
    );

    // Check line count and truncate if needed
    const lines = patch.split('\n');
    if (lines.length > MAX_DIFF_LINES) {
      const truncated = lines.slice(0, MAX_DIFF_LINES).join('\n');
      return `${truncated}\n... [diff truncated, full PRD available] ...`;
    }

    return patch;
  } catch {
    // If diff generation fails, return empty string per FR7
    return '';
  }
}

/**
 * Check if a diff would be too large to be useful.
 *
 * @param oldText - The original text
 * @param newText - The updated text
 * @returns true if diff would exceed MAX_DIFF_LINES
 */
export function isDiffTooLarge(oldText: string, newText: string): boolean {
  try {
    const patch = createPatch('check', oldText, newText, '', '', {
      context: CONTEXT_LINES,
    });
    return patch.split('\n').length > MAX_DIFF_LINES;
  } catch {
    return false;
  }
}

/**
 * Generate a simple summary of changes between two texts.
 * Useful when full diff is too large or not needed.
 *
 * @param oldText - The original text
 * @param newText - The updated text
 * @returns Summary string with line count changes
 */
export function generateDiffSummary(oldText: string, newText: string): string {
  const oldLines = oldText.split('\n').length;
  const newLines = newText.split('\n').length;
  const diff = newLines - oldLines;

  if (diff === 0) {
    return `${newLines} lines (modified in place)`;
  } else if (diff > 0) {
    return `${oldLines} → ${newLines} lines (+${diff})`;
  } else {
    return `${oldLines} → ${newLines} lines (${diff})`;
  }
}
