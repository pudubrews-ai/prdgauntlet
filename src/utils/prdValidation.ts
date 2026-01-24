// ============================================================================
// PRD Validation - Verify PRD completeness before marking jobs complete
// ============================================================================

import { logger } from './logger.js';

export interface PrdValidationResult {
  isValid: boolean;
  issues: string[];
  diagnostics: {
    endsCleanly: boolean;
    hasValidMarkdown: boolean;
    hasMinimumSections: boolean;
    lastContent: string;
    expectedSections?: string[];
    missingSections?: string[];
    truncationIndicators?: string[];
  };
}

/**
 * Validates that a PRD is complete and not truncated
 *
 * Checks:
 * - PRD doesn't end mid-code (incomplete function, for loop, etc.)
 * - Markdown structure is valid (no unclosed code blocks)
 * - Has basic PRD structure (at least some headings)
 * - No obvious truncation patterns
 */
export function validatePrdCompleteness(prd: string): PrdValidationResult {
  const issues: string[] = [];
  const diagnostics: PrdValidationResult['diagnostics'] = {
    endsCleanly: true,
    hasValidMarkdown: true,
    hasMinimumSections: true,
    lastContent: prd.slice(-200),
  };

  // 1. Check for obvious truncation patterns (mid-code, incomplete statements)
  const truncationCheck = checkTruncationIndicators(prd);
  if (!truncationCheck.valid) {
    issues.push(...truncationCheck.issues);
    diagnostics.endsCleanly = false;
    diagnostics.truncationIndicators = truncationCheck.indicators;
  }

  // 2. Check markdown structure validity
  const markdownValid = checkMarkdownStructure(prd);
  if (!markdownValid.valid) {
    issues.push(...markdownValid.issues);
    diagnostics.hasValidMarkdown = false;
  }

  // 3. Check for minimum expected structure (at least some headings)
  const structureValid = checkMinimumStructure(prd);
  if (!structureValid.valid) {
    issues.push(structureValid.issue);
    diagnostics.hasMinimumSections = false;
  }

  const isValid = issues.length === 0;

  if (!isValid) {
    logger.logWarn('PRD validation failed', {
      issueCount: issues.length,
      issues,
      lastContent: diagnostics.lastContent,
    });
  }

  return {
    isValid,
    issues,
    diagnostics,
  };
}

/**
 * Check for common truncation indicators
 * This is the MOST IMPORTANT check - detects incomplete code/text
 */
function checkTruncationIndicators(prd: string): {
  valid: boolean;
  issues: string[];
  indicators: string[];
} {
  const issues: string[] = [];
  const indicators: string[] = [];

  // Get last 500 chars for checking
  const tail = prd.trim().slice(-500);

  // Pattern 1: Incomplete TypeScript/JavaScript (HIGH PRIORITY - this caught job 4f268bbd)
  const incompleteCodePatterns = [
    { pattern: /for\s*\(\s*const\s+\w+\s*$/, name: 'for (const variable' },
    { pattern: /function\s+\w+\s*\([^)]*$/, name: 'function declaration without closing paren' },
    { pattern: /\bif\s*\(\s*[^)]*$/, name: 'if statement without closing paren' },
    { pattern: /interface\s+\w+\s*\{[^}]*$/, name: 'interface without closing brace' },
    { pattern: /\{\s*\n?\s*"\w+":\s*[^}]*$/, name: 'object literal without closing brace' },
    { pattern: /=>\s*\{[^}]*$/, name: 'arrow function without closing brace' },
  ];

  for (const { pattern, name } of incompleteCodePatterns) {
    if (pattern.test(tail)) {
      issues.push(`PRD ends with incomplete code: ${name}`);
      indicators.push('incomplete code');
      break; // One incomplete code pattern is enough
    }
  }

  // Pattern 2: Ends with trailing ellipsis (unless in code example)
  if (/\.\.\.\s*$/.test(tail) && !tail.includes('```')) {
    issues.push('PRD ends with "..." which suggests truncation');
    indicators.push('trailing ellipsis');
  }

  // Pattern 3: Markdown table without completion
  const lines = tail.split('\n');
  const lastLine = lines[lines.length - 1];
  if (lastLine.trim().startsWith('|') && !lastLine.trim().endsWith('|')) {
    issues.push('PRD ends with incomplete markdown table row');
    indicators.push('incomplete table');
  }

  return {
    valid: issues.length === 0,
    issues,
    indicators,
  };
}

/**
 * Check markdown structure validity
 */
function checkMarkdownStructure(prd: string): { valid: boolean; issues: string[] } {
  const issues: string[] = [];

  // Count code block markers
  const codeBlockMarkers = prd.match(/```/g) || [];
  if (codeBlockMarkers.length % 2 !== 0) {
    issues.push(`Unclosed code block detected (found ${codeBlockMarkers.length} triple-backtick markers, expected even number)`);
  }

  // Check for orphaned headings (heading at very end with no content after)
  const lines = prd.trim().split('\n');
  const lastLine = lines[lines.length - 1];

  if (/^#{1,6}\s+.+/.test(lastLine)) {
    // Last line is a heading - check if it's a known terminal section
    const knownTerminalSections = ['Appendix', 'References', 'Glossary', 'Version History', 'Changelog'];
    const headingText = lastLine.replace(/^#{1,6}\s+/, '').trim();

    if (!knownTerminalSections.some(section => headingText.includes(section))) {
      issues.push(`PRD ends with heading "${headingText}" but no content follows - possible truncation`);
    }
  }

  // Check for incomplete lists (list item without content)
  if (/^[\s]*[-*]\s*$/.test(lastLine) || /^\d+\.\s*$/.test(lastLine)) {
    issues.push('PRD ends with empty list item - possible truncation');
  }

  return {
    valid: issues.length === 0,
    issues,
  };
}

/**
 * Check for minimum expected structure
 * Much more lenient than checking for specific sections - just needs SOME structure
 */
function checkMinimumStructure(prd: string): {
  valid: boolean;
  issue: string;
} {
  const trimmed = prd.trim();

  if (trimmed.length === 0) {
    return { valid: false, issue: 'PRD is empty' };
  }

  // Just check for at least one ## heading (basic markdown structure)
  const hasHeadings = /^#{2,}\s+.+/m.test(trimmed);
  if (!hasHeadings) {
    return {
      valid: false,
      issue: 'PRD has no markdown headings - likely truncated or not a valid PRD',
    };
  }

  return { valid: true, issue: '' };
}

/**
 * Format validation result for user-facing error message
 */
export function formatValidationError(result: PrdValidationResult): string {
  let message = 'PRD validation failed:\n\n';

  message += result.issues.map((issue, i) => `${i + 1}. ${issue}`).join('\n');

  message += '\n\nDiagnostics:\n';
  message += `- Ends cleanly: ${result.diagnostics.endsCleanly ? 'Yes' : 'No'}\n`;
  message += `- Valid markdown: ${result.diagnostics.hasValidMarkdown ? 'Yes' : 'No'}\n`;
  message += `- Has minimum sections: ${result.diagnostics.hasMinimumSections ? 'Yes' : 'No'}\n`;

  if (result.diagnostics.missingSections && result.diagnostics.missingSections.length > 0) {
    message += `\nMissing sections: ${result.diagnostics.missingSections.join(', ')}\n`;
  }

  if (result.diagnostics.truncationIndicators && result.diagnostics.truncationIndicators.length > 0) {
    message += `\nTruncation indicators: ${result.diagnostics.truncationIndicators.join(', ')}\n`;
  }

  message += `\nLast 200 characters of PRD:\n"${result.diagnostics.lastContent}"\n`;

  message += '\nRecommendation: Increase maxTokens, reduce PRD scope, or split into multiple documents.';

  return message;
}
