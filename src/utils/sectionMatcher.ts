// ============================================================================
// Section Matcher - Hierarchical path matching for targeted re-debate (PRD v3.0)
// ============================================================================

import { logger } from './logger.js';

/**
 * Section in the PRD
 */
export interface Section {
  path: string; // e.g., "FR4 > Rate Limiting"
  heading: string; // e.g., "Rate Limiting"
  level: number; // 1 for #, 2 for ##, etc.
  lineStart: number;
  lineEnd: number;
  content: string;
}

/**
 * Section match result
 */
export interface SectionMatchResult {
  matched: boolean;
  section?: Section;
  error?: {
    code: 'ambiguous_section_path' | 'section_not_found';
    message: string;
    candidates?: string[];
    suggestion?: string;
  };
}

/**
 * Parse PRD into hierarchical sections
 */
export function parsePrdSections(prd: string): Section[] {
  const lines = prd.split('\n');
  const sections: Section[] = [];
  const stack: Array<{ heading: string; level: number }> = [];

  let currentSection: Partial<Section> | null = null;
  let currentLineStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#+)\s+(.+)/);

    if (headerMatch) {
      // Save previous section
      if (currentSection) {
        currentSection.lineEnd = i - 1;
        currentSection.content = lines
          .slice(currentSection.lineStart!, currentSection.lineEnd + 1)
          .join('\n');
        sections.push(currentSection as Section);
      }

      // Start new section
      const level = headerMatch[1].length;
      const heading = headerMatch[2].trim();

      // Update stack (remove deeper levels)
      while (stack.length > 0 && stack[stack.length - 1].level >= level) {
        stack.pop();
      }

      stack.push({ heading, level });

      // Build hierarchical path
      const path = stack.map(s => s.heading).join(' > ');

      currentSection = {
        path,
        heading,
        level,
        lineStart: i,
      };
      currentLineStart = i;
    }
  }

  // Save final section
  if (currentSection) {
    currentSection.lineEnd = lines.length - 1;
    currentSection.content = lines
      .slice(currentSection.lineStart!, currentSection.lineEnd + 1)
      .join('\n');
    sections.push(currentSection as Section);
  }

  logger.logDebug('Parsed PRD sections', { count: sections.length });

  return sections;
}

/**
 * Match a section path to a section in the PRD
 */
export function matchSection(
  sectionPath: string,
  prd: string
): SectionMatchResult {
  const sections = parsePrdSections(prd);

  // Try exact match first
  const exactMatches = sections.filter(s => s.path === sectionPath);

  if (exactMatches.length === 1) {
    logger.logDebug('Exact section match found', { path: sectionPath });
    return { matched: true, section: exactMatches[0] };
  }

  if (exactMatches.length > 1) {
    // Multiple exact matches (shouldn't happen but handle it)
    logger.logWarn('Multiple exact matches found', { path: sectionPath });
    return {
      matched: false,
      error: {
        code: 'ambiguous_section_path',
        message: `Section path '${sectionPath}' matched multiple sections`,
        candidates: exactMatches.map(s => s.path),
        suggestion:
          'Please use exact section heading or update PRD to use consistent naming',
      },
    };
  }

  // Try fuzzy match with 80% similarity threshold
  const fuzzyMatches = sections
    .map(section => ({
      section,
      similarity: calculateSimilarity(sectionPath, section.path),
    }))
    .filter(m => m.similarity >= 0.8)
    .sort((a, b) => b.similarity - a.similarity);

  if (fuzzyMatches.length === 0) {
    logger.logWarn('No section match found', { path: sectionPath });
    return {
      matched: false,
      error: {
        code: 'section_not_found',
        message: `Section path '${sectionPath}' not found in PRD`,
        candidates: sections.map(s => s.path).slice(0, 5), // Top 5 suggestions
        suggestion: 'Check section path spelling and hierarchy',
      },
    };
  }

  if (fuzzyMatches.length === 1) {
    logger.logInfo('Fuzzy section match found', {
      path: sectionPath,
      matched: fuzzyMatches[0].section.path,
      similarity: Math.round(fuzzyMatches[0].similarity * 100) + '%',
    });
    return { matched: true, section: fuzzyMatches[0].section };
  }

  // Multiple fuzzy matches - fail with ambiguity error
  logger.logWarn('Multiple fuzzy matches found', { path: sectionPath });
  return {
    matched: false,
    error: {
      code: 'ambiguous_section_path',
      message: `Section path '${sectionPath}' matched multiple sections`,
      candidates: fuzzyMatches.map(
        m => `${m.section.path} (${Math.round(m.similarity * 100)}% match)`
      ),
      suggestion:
        'Please use exact section heading or update PRD to use consistent naming',
    },
  };
}

/**
 * Calculate string similarity (Levenshtein-based)
 */
function calculateSimilarity(str1: string, str2: string): number {
  const s1 = str1.toLowerCase();
  const s2 = str2.toLowerCase();

  if (s1 === s2) return 1.0;

  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(s1, s2);
  return 1 - distance / maxLen;
}

/**
 * Levenshtein distance calculation
 */
function levenshteinDistance(str1: string, str2: string): number {
  const matrix: number[][] = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1, // substitution
          matrix[i][j - 1] + 1, // insertion
          matrix[i - 1][j] + 1 // deletion
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Extract section content by path
 */
export function extractSectionContent(
  sectionPath: string,
  prd: string
): { content: string; lineStart: number; lineEnd: number } | null {
  const matchResult = matchSection(sectionPath, prd);

  if (!matchResult.matched || !matchResult.section) {
    return null;
  }

  return {
    content: matchResult.section.content,
    lineStart: matchResult.section.lineStart,
    lineEnd: matchResult.section.lineEnd,
  };
}

/**
 * Check if a section path is frozen (not in targeted sections list)
 */
export function isSectionFrozen(
  sectionPath: string,
  targetedSections: string[]
): boolean {
  return !targetedSections.some(target => sectionPath.startsWith(target));
}
