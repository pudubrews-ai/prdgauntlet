// ============================================================================
// Spec Review Parser - Two-document parser for defender responses (v4.0)
// ============================================================================

export interface SpecReviewDelimiters {
  appSpecStart: string;
  appSpecEnd: string;
  testSpecStart: string;
  testSpecEnd: string;
}

export interface SpecReviewParseResult {
  updatedAppSpecSection: string;
  updatedTestSpec: string;
  parseError?: string;
}

/**
 * Escape a string for use in a RegExp
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Parse two-document defender response using UUID-prefixed delimiters (S-7).
 *
 * Falls back to heuristic markdown H1 header splitting if delimiters are missing.
 * Returns a typed result — never throws.
 */
export function parseSpecReviewResponse(
  response: string,
  delimiters: SpecReviewDelimiters
): SpecReviewParseResult {
  // Primary: delimiter-based extraction
  const appSpecRegex = new RegExp(
    escapeRegExp(delimiters.appSpecStart) + '([\\s\\S]*?)' + escapeRegExp(delimiters.appSpecEnd),
    'i'
  );
  const testSpecRegex = new RegExp(
    escapeRegExp(delimiters.testSpecStart) + '([\\s\\S]*?)' + escapeRegExp(delimiters.testSpecEnd),
    'i'
  );

  const appSpecMatch = response.match(appSpecRegex);
  const testSpecMatch = response.match(testSpecRegex);

  if (appSpecMatch && testSpecMatch) {
    const updatedAppSpecSection = appSpecMatch[1].trim();
    const updatedTestSpec = testSpecMatch[1].trim();

    if (updatedAppSpecSection.length === 0 && updatedTestSpec.length === 0) {
      return {
        updatedAppSpecSection: '',
        updatedTestSpec: '',
        parseError: 'Delimiters found but both documents are empty.',
      };
    }

    if (updatedAppSpecSection.length === 0) {
      return {
        updatedAppSpecSection: '',
        updatedTestSpec,
        parseError: 'App spec section delimiter found but content is empty.',
      };
    }

    if (updatedTestSpec.length === 0) {
      return {
        updatedAppSpecSection,
        updatedTestSpec: '',
        parseError: 'Test spec delimiter found but content is empty.',
      };
    }

    return { updatedAppSpecSection, updatedTestSpec };
  }

  // Partial delimiter match — one document found, one missing
  if (appSpecMatch && !testSpecMatch) {
    const updatedAppSpecSection = appSpecMatch[1].trim();
    return {
      updatedAppSpecSection,
      updatedTestSpec: '',
      parseError: 'Only app spec section delimiters found; test spec delimiters missing.',
    };
  }

  if (!appSpecMatch && testSpecMatch) {
    const updatedTestSpec = testSpecMatch[1].trim();
    return {
      updatedAppSpecSection: '',
      updatedTestSpec,
      parseError: 'Only test spec delimiters found; app spec section delimiters missing.',
    };
  }

  // Fallback: heuristic split on markdown H1 headers
  const h1Splits = response.split(/^#\s+[^\n]+/m);

  // Find top-level sections: look for "App Spec" and "Test Spec" headings
  const headingMatches = [...response.matchAll(/^(#{1,2})\s+(.+)$/gm)];

  if (headingMatches.length >= 2) {
    // Try to identify which sections are app spec vs test spec
    let appSpecContent = '';
    let testSpecContent = '';

    for (let i = 0; i < headingMatches.length; i++) {
      const heading = headingMatches[i][2].toLowerCase();
      const isAppSpec = heading.includes('app spec') || heading.includes('application spec') || heading.includes('spec section');
      const isTestSpec = heading.includes('test spec') || heading.includes('test suite') || heading.includes('tests');

      const nextHeadingIndex = headingMatches[i + 1]?.index ?? response.length;
      const sectionContent = response.slice(headingMatches[i].index!, nextHeadingIndex).trim();

      if (isAppSpec && appSpecContent === '') {
        appSpecContent = sectionContent;
      } else if (isTestSpec && testSpecContent === '') {
        testSpecContent = sectionContent;
      }
    }

    if (appSpecContent.length > 0 && testSpecContent.length > 0) {
      return {
        updatedAppSpecSection: appSpecContent,
        updatedTestSpec: testSpecContent,
        parseError: 'Delimiter-based parsing failed; used markdown header heuristic as fallback.',
      };
    }

    // Rough split: use first and second major sections
    if (h1Splits.length >= 3) {
      const firstSection = h1Splits[1]?.trim() ?? '';
      const remainingSections = h1Splits.slice(2).join('\n').trim();

      if (firstSection.length > 0 && remainingSections.length > 0) {
        return {
          updatedAppSpecSection: firstSection,
          updatedTestSpec: remainingSections,
          parseError: 'Delimiter-based parsing failed; used H1 section split as fallback.',
        };
      }
    }
  }

  // Total failure — cannot split at all
  return {
    updatedAppSpecSection: '',
    updatedTestSpec: '',
    parseError: 'No delimiters found and heuristic fallback could not identify two distinct documents.',
  };
}
