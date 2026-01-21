// ============================================================================
// Research Protocol - Web search for undefined terms (PRD v3.0)
// ============================================================================

import { getTerminologyCache, type CachedTerm } from './terminologyCache.js';
import { logger } from './logger.js';

export interface ResearchResult {
  found: boolean;
  term: string;
  fullName?: string;
  version?: string;
  sourceUrl?: string;
  specification?: string;
  multipleStandards?: StandardOption[];
  needsUserInput?: boolean;
  reason?: string;
}

export interface StandardOption {
  name: string;
  version: string;
  url: string;
  releasedDate?: string;
  usedBy?: string[];
}

/**
 * NOTE: This is a placeholder for the actual web search implementation.
 * In a real implementation, this would:
 * 1. Call a web search API (e.g., Google Custom Search, Bing Search)
 * 2. Parse results to find authoritative specifications
 * 3. Prioritize official specs (W3C, IETF, ISO, etc.)
 *
 * For now, this function is designed to be integrated with Claude's web_search tool
 * when the MCP server is called by Claude.
 */
async function webSearch(query: string): Promise<any[]> {
  // This will be called via Claude's web_search tool in the actual implementation
  // The AI critic/defender will trigger this search when encountering undefined terms
  logger.logDebug('Web search triggered', { query });

  // Placeholder - in real implementation, this would be replaced by actual search
  throw new Error(
    'Web search must be performed by the AI model using their web_search tool. ' +
    'This function is a placeholder for documentation purposes.'
  );
}

/**
 * Research an undefined term using web search
 * This function documents the protocol, but actual search is performed by AI models
 */
export async function researchTerm(
  term: string,
  context?: string
): Promise<ResearchResult> {
  logger.logInfo('Researching term', { term, hasContext: !!context });

  // Step 1: Check cache first
  const cache = getTerminologyCache();
  const cached = cache.get(term);

  if (cached) {
    logger.logInfo('Term found in cache', { term });
    return {
      found: true,
      term,
      fullName: cached.fullName,
      version: cached.version,
      sourceUrl: cached.sourceUrl,
      specification: cached.specification,
    };
  }

  // Step 2: Search for the term
  // Note: In actual implementation, the AI model will use web_search tool
  const searchQuery = `"${term}" specification`;
  logger.logDebug('Search query', { query: searchQuery });

  // The AI model should search for:
  // - Official specification documents
  // - RFCs, W3C standards, ISO specs
  // - Authoritative GitHub repositories
  // - Official documentation sites

  // Placeholder result - in real implementation this comes from web_search
  return {
    found: false,
    term,
    needsUserInput: true,
    reason: 'Web search must be performed by AI model with web_search tool',
  };
}

/**
 * Resolve conflicting standards when multiple are found
 * Prioritization order per PRD v3.0:
 * 1. Official specification bodies (W3C, IETF, ISO)
 * 2. Original creators/maintainers (GitHub official repos)
 * 3. Most recent stable release
 * 4. Most widely adopted
 */
export function resolveConflictingStandards(
  term: string,
  standards: StandardOption[]
): StandardOption | null {
  if (standards.length === 0) {
    return null;
  }

  if (standards.length === 1) {
    return standards[0];
  }

  logger.logInfo('Multiple standards found for term', {
    term,
    count: standards.length,
    standards: standards.map(s => `${s.name} ${s.version}`)
  });

  // Priority 1: Official specification bodies
  const officialBodies = ['w3.org', 'ietf.org', 'iso.org', 'rfc-editor.org'];
  const officialStandards = standards.filter(s =>
    officialBodies.some(body => s.url.toLowerCase().includes(body))
  );

  if (officialStandards.length === 1) {
    logger.logInfo('Selected official standard', {
      term,
      selected: `${officialStandards[0].name} ${officialStandards[0].version}`
    });
    return officialStandards[0];
  }

  // Priority 2: Most recent version
  // (requires version comparison - simplified here)
  const sorted = [...standards].sort((a, b) => {
    // Simple version comparison (assumes semver-like format)
    const versionA = parseFloat(a.version.replace(/[^\d.]/g, ''));
    const versionB = parseFloat(b.version.replace(/[^\d.]/g, ''));
    return versionB - versionA;
  });

  logger.logInfo('Selected most recent version', {
    term,
    selected: `${sorted[0].name} ${sorted[0].version}`
  });

  return sorted[0];
}

/**
 * Build the required changes message for PRD when undefined term is found
 */
export function buildTerminologyRequiredChanges(
  term: string,
  fullName: string,
  version: string,
  sourceUrl: string,
  specification: string
): string {
  return `
REQUIRED CHANGES for term "${term}":

1. Add to PRD Terminology section:
   \`\`\`markdown
   **${term}**: ${fullName} (${version}) - ${specification}
   Source: ${sourceUrl}
   \`\`\`

2. If the PRD references ${term} in requirements, clarify:
   - Which features of ${fullName} are in scope
   - Compliance requirements (must support, should support, optional)
   - Version compatibility (support ${version} only, or backwards compatible?)

3. Add acceptance criteria related to ${term} compliance
`;
}

/**
 * Cache a researched term
 */
export function cacheResearchedTerm(result: ResearchResult): void {
  if (!result.found || !result.fullName || !result.version || !result.sourceUrl || !result.specification) {
    return;
  }

  const cache = getTerminologyCache();
  cache.set(result.term, {
    term: result.term,
    fullName: result.fullName,
    version: result.version,
    sourceUrl: result.sourceUrl,
    specification: result.specification,
    cachedAt: new Date(),
  });

  logger.logInfo('Term cached', { term: result.term, version: result.version });
}

/**
 * Extract technical terms and acronyms from text
 * This is a simple regex-based extractor
 * In Phase 3, this could use NLP for better accuracy
 */
export function extractTechnicalTerms(text: string): string[] {
  const terms: Set<string> = new Set();

  // Pattern 1: All-caps acronyms (2+ letters)
  const acronymPattern = /\b[A-Z]{2,}\b/g;
  const acronyms = text.match(acronymPattern) || [];
  acronyms.forEach(term => {
    // Filter out common non-technical all-caps words
    if (!['OK', 'FAQ', 'TBD', 'TODO', 'FYI', 'ASAP'].includes(term)) {
      terms.add(term);
    }
  });

  // Pattern 2: Technical terms in backticks
  const backtickPattern = /`([^`]+)`/g;
  let match;
  while ((match = backtickPattern.exec(text)) !== null) {
    const term = match[1].trim();
    if (term.length > 1 && /^[A-Za-z0-9-_.]+$/.test(term)) {
      terms.add(term);
    }
  }

  // Pattern 3: Capitalized technical terms (CamelCase, PascalCase)
  const camelCasePattern = /\b([A-Z][a-z]+[A-Z][a-zA-Z]*)\b/g;
  const camelCase = text.match(camelCasePattern) || [];
  camelCase.forEach(term => {
    if (term.length > 3) {
      terms.add(term);
    }
  });

  return Array.from(terms);
}

/**
 * Check if a term is already defined in the PRD's Terminology section
 */
export function isTermDefined(term: string, prd: string): boolean {
  // Look for the Terminology section
  const terminologySection = prd.match(/##\s+Terminology.*?(?=\n##|\n$)/is);

  if (!terminologySection) {
    return false;
  }

  const section = terminologySection[0];

  // Check for term definition patterns:
  // - **TERM**: definition
  // - - TERM: definition
  // - **TERM** - definition
  const definitionPatterns = [
    new RegExp(`\\*\\*${term}\\*\\*\\s*[:-]`, 'i'),
    new RegExp(`^-\\s+${term}\\s*[:-]`, 'im'),
    new RegExp(`^\\*\\s+${term}\\s*[:-]`, 'im'),
  ];

  return definitionPatterns.some(pattern => pattern.test(section));
}

/**
 * Extract all undefined terms from a PRD
 */
export function getUndefinedTerms(prd: string): string[] {
  const allTerms = extractTechnicalTerms(prd);
  const undefined = allTerms.filter(term => !isTermDefined(term, prd));

  logger.logDebug('Undefined terms found', {
    total: allTerms.length,
    undefined: undefined.length,
    terms: undefined
  });

  return undefined;
}
