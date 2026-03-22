// ============================================================================
// Cross-Document Report - Post-processing alignment analysis (v4.0)
// ============================================================================

import type { CrossDocumentReport, CrossDocumentMismatch } from '../types/index.js';

/**
 * Escape a string for safe use in a RegExp (S1: no raw new RegExp() on user content).
 */
function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Recognized template placeholders (S2/S5: allowlist only — no catch-all).
 */
const PLACEHOLDER_PATTERN = /\{(?:n|N|id|index|i|[0-9])\}/g;

/**
 * Check whether one value is a template and the other is a concrete instance of it.
 * Security requirements:
 *   S1: escapeRegExp() applied to all non-placeholder segments.
 *   S2: Only allowlisted placeholders treated as wildcards ([^-]+ per segment).
 *   S3: Cap at 3 placeholders per value to prevent regex complexity explosion.
 *   S4: Skip template matching if value is longer than 100 characters.
 */
export function isTemplateMatch(a: string, b: string): boolean {
  // Security: skip if either value is too long (S4)
  if (a.length > 100 || b.length > 100) return false;

  // Identify which (if any) is the template
  const aPlaceholders = (a.match(PLACEHOLDER_PATTERN) || []).length;
  const bPlaceholders = (b.match(PLACEHOLDER_PATTERN) || []).length;

  const templateStr = aPlaceholders > 0 ? a : bPlaceholders > 0 ? b : null;
  const concreteStr = templateStr === a ? b : a;

  if (!templateStr) return false;

  // Security: cap at 3 placeholders (S3)
  const placeholderCount = (templateStr.match(PLACEHOLDER_PATTERN) || []).length;
  if (placeholderCount > 3) return false;

  // Build regex: split on recognized placeholders, escape literal segments, rejoin
  // Replace each placeholder with [^-]+ (single hyphen-delimited segment) (S2)
  const parts = templateStr.split(PLACEHOLDER_PATTERN);
  const escapedParts = parts.map(escapeRegExp);
  const regexSource = '^' + escapedParts.join('[^-]+') + '$';

  try {
    const regex = new RegExp(regexSource);
    return regex.test(concreteStr);
  } catch {
    return false;
  }
}

/**
 * Pair testids from app spec and test spec using content-level strategies.
 * Bug 4: Replaces aggressive includes() substring matching with semantic pairing.
 *
 * Strategies (in order):
 * 1. Backtick extraction near "testid"/"test-id"/"data-testid" keywords
 * 2. Markdown table columns with "testid" or "test id" header
 * 3. getByTestId('...') call extraction
 * 4. Unpaired fallback: only flag when same hyphenated prefix, last segment differs
 *
 * Returns an array of {appValue, testValue} pairs that are candidates for mismatch.
 */
function pairTestIds(
  appTestIds: string[],
  testSpecTestIds: string[],
  testSpecRaw: string
): Array<{ appValue: string; testValue: string }> {
  const pairs: Array<{ appValue: string; testValue: string }> = [];
  const pairedApp = new Set<string>();
  const pairedTest = new Set<string>();

  // Strategy 1: backtick extraction near testid keywords
  const backtickPattern = /`([^`]+)`/g;
  const testSpecLines = testSpecRaw.split('\n');
  const backtickTestIds = new Set<string>();
  for (const line of testSpecLines) {
    const lower = line.toLowerCase();
    if (lower.includes('testid') || lower.includes('test-id') || lower.includes('data-testid')) {
      const matches = [...line.matchAll(backtickPattern)];
      for (const m of matches) {
        backtickTestIds.add(m[1]);
      }
    }
  }

  // Strategy 2: markdown table column with testid/test id header
  const tableTestIds = new Set<string>();
  let inTestIdColumn = false;
  let testIdColumnIdx = -1;
  for (const line of testSpecLines) {
    if (line.trim().startsWith('|')) {
      const cells = line.split('|').map(c => c.trim()).filter(Boolean);
      // Check if this is a header row
      if (testIdColumnIdx === -1) {
        testIdColumnIdx = cells.findIndex(c => c.toLowerCase().includes('testid') || c.toLowerCase().includes('test id'));
        if (testIdColumnIdx !== -1) inTestIdColumn = true;
      } else if (inTestIdColumn && testIdColumnIdx < cells.length) {
        const cell = cells[testIdColumnIdx];
        // Skip separator rows (---|---)
        if (!/^-+$/.test(cell) && cell.length > 0) {
          tableTestIds.add(cell);
        }
      }
    } else {
      // Reset on non-table line
      inTestIdColumn = false;
      testIdColumnIdx = -1;
    }
  }

  // Strategy 3: getByTestId('...') or getByTestId("...") extraction
  const getByTestIdPattern = /getByTestId\(["']([^"']+)["']\)/g;
  const getByTestIds = new Set<string>();
  for (const m of testSpecRaw.matchAll(getByTestIdPattern)) {
    getByTestIds.add(m[1]);
  }

  // Combine all extracted test-spec testids
  const extractedTestIds = new Set([...backtickTestIds, ...tableTestIds, ...getByTestIds]);

  // Pair by exact match with app spec testids
  for (const appId of appTestIds) {
    if (extractedTestIds.has(appId)) {
      // Exact match — no mismatch
      pairedApp.add(appId);
      pairedTest.add(appId);
    }
  }

  // Strategy 4: Unpaired fallback
  // Only flag when same hyphenated prefix (up to last segment) AND last segment differs
  for (const appId of appTestIds) {
    if (pairedApp.has(appId)) continue;
    for (const testId of testSpecTestIds) {
      if (pairedTest.has(testId)) continue;
      if (appId === testId) continue;

      const appParts = appId.split('-');
      const testParts = testId.split('-');

      // Must have same depth AND same prefix (all segments except last)
      if (appParts.length !== testParts.length || appParts.length < 2) continue;

      const appPrefix = appParts.slice(0, -1).join('-');
      const testPrefix = testParts.slice(0, -1).join('-');

      if (appPrefix === testPrefix && appParts[appParts.length - 1] !== testParts[testParts.length - 1]) {
        pairs.push({ appValue: appId, testValue: testId });
        pairedApp.add(appId);
        pairedTest.add(testId);
      }
    }
  }

  return pairs;
}

/**
 * Normalize a string for comparison: trim, collapse whitespace, strip surrounding quotes.
 */
function normalize(s: string): string {
  return s
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/^["']|["']$/g, '');
}

/**
 * Extract behaviors from an app spec section.
 * Behaviors are identified by patterns such as:
 * - Endpoint definitions (GET /path, POST /path, etc.)
 * - UI action descriptions (button click, form submit, etc.)
 * - Error conditions (should return 4xx, error message, etc.)
 * - Numbered requirements (1. The system shall...)
 */
export function extractAppSpecBehaviors(appSpec: string): string[] {
  const behaviors: string[] = [];
  const lines = appSpec.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;

    // HTTP endpoints
    if (/^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS)\s+\//i.test(trimmed)) {
      behaviors.push(normalize(trimmed));
      continue;
    }

    // Numbered requirements
    if (/^\d+\.\s+.{20,}/.test(trimmed)) {
      behaviors.push(normalize(trimmed));
      continue;
    }

    // Bullet-point behaviors
    if (/^[-*•]\s+.{20,}/.test(trimmed)) {
      behaviors.push(normalize(trimmed));
      continue;
    }

    // "shall", "must", "should", "will" requirements
    if (/\b(shall|must|should|will)\b.{15,}/.test(trimmed)) {
      behaviors.push(normalize(trimmed));
      continue;
    }

    // Error conditions
    if (/\b(error|returns?\s+\d{3}|throws?|fails?|rejects?)\b/i.test(trimmed) && trimmed.length > 20) {
      behaviors.push(normalize(trimmed));
      continue;
    }
  }

  return [...new Set(behaviors)]; // deduplicate
}

/**
 * Check if a behavior is covered by the test spec.
 * Uses keyword overlap to determine coverage.
 */
function isBehaviorCovered(behavior: string, testSpec: string): boolean {
  const normalizedBehavior = normalize(behavior).toLowerCase();
  const normalizedTestSpec = testSpec.toLowerCase();

  // Extract key terms from the behavior (skip common words)
  const stopWords = new Set([
    'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
    'of', 'with', 'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been',
    'has', 'have', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'shall', 'may', 'might', 'must', 'can', 'that', 'this',
    'it', 'its', 'when', 'if', 'then', 'else', 'not', 'no', 'all',
  ]);

  const keyTerms = normalizedBehavior
    .split(/\W+/)
    .filter(t => t.length > 3 && !stopWords.has(t));

  if (keyTerms.length === 0) return false;

  // Require at least half the key terms to appear in the test spec
  const matchCount = keyTerms.filter(t => normalizedTestSpec.includes(t)).length;
  return matchCount >= Math.ceil(keyTerms.length / 2);
}

/**
 * Extract string values that look like error messages, labels, or user-facing copy.
 * Returns a map of normalized_value -> location
 */
function extractStrings(doc: string, docLabel: string): Array<{ value: string; location: string }> {
  const results: Array<{ value: string; location: string }> = [];
  const lines = doc.split('\n');

  let currentSection = 'root';
  lines.forEach((line, idx) => {
    const trimmed = line.trim();
    if (trimmed.startsWith('#')) {
      currentSection = trimmed.replace(/^#+\s*/, '');
    }

    // Extract quoted strings longer than 5 chars (likely user-facing text)
    const quotedMatches = [...trimmed.matchAll(/["']([^"']{5,})["']/g)];
    for (const m of quotedMatches) {
      results.push({
        value: normalize(m[1]),
        location: `${docLabel}:${currentSection}:line${idx + 1}`,
      });
    }

    // Extract data-testid values
    const testIdMatches = [...trimmed.matchAll(/data-testid=["']([^"']+)["']/gi)];
    for (const m of testIdMatches) {
      results.push({
        value: `data-testid:${normalize(m[1])}`,
        location: `${docLabel}:${currentSection}:line${idx + 1}`,
      });
    }

    // Extract aria-label values
    const ariaMatches = [...trimmed.matchAll(/aria-label=["']([^"']+)["']/gi)];
    for (const m of ariaMatches) {
      results.push({
        value: `aria-label:${normalize(m[1])}`,
        location: `${docLabel}:${currentSection}:line${idx + 1}`,
      });
    }
  });

  return results;
}

/**
 * Detect string and attribute mismatches between app spec and test spec.
 * Bug 4: Uses semantic pairTestIds() instead of aggressive includes() substring matching.
 * Bug 5: Applies isTemplateMatch() to skip template-vs-instance false positives.
 */
export function detectMismatches(
  appSpec: string,
  testSpec: string
): CrossDocumentMismatch[] {
  const mismatches: CrossDocumentMismatch[] = [];

  const appStrings = extractStrings(appSpec, 'app-spec');
  const testStrings = extractStrings(testSpec, 'test-spec');

  // Build lookup maps
  const appMap = new Map<string, string>(); // value -> location
  for (const { value, location } of appStrings) {
    appMap.set(value, location);
  }

  const testMap = new Map<string, string>(); // value -> location
  for (const { value, location } of testStrings) {
    testMap.set(value, location);
  }

  // -------------------------------------------------------------------------
  // Attribute mismatch detection (Bug 4: replace includes() with pairTestIds)
  // -------------------------------------------------------------------------

  // Collect testid values from each doc (strip prefix)
  const appTestIds: string[] = [];
  const testTestIds: string[] = [];
  for (const [value] of appMap) {
    if (value.startsWith('data-testid:')) {
      appTestIds.push(value.split(':').slice(1).join(':'));
    }
  }
  for (const [value] of testMap) {
    if (value.startsWith('data-testid:')) {
      testTestIds.push(value.split(':').slice(1).join(':'));
    }
  }

  // Get semantically paired testid mismatches
  const testIdPairs = pairTestIds(appTestIds, testTestIds, testSpec);

  for (const { appValue, testValue } of testIdPairs) {
    // Bug 5: skip template-vs-instance pairs
    if (isTemplateMatch(appValue, testValue)) continue;

    // Find locations
    const appLoc = appMap.get(`data-testid:${appValue}`) ?? `app-spec:unknown`;
    const testLoc = testMap.get(`data-testid:${testValue}`) ?? `test-spec:unknown`;

    mismatches.push({
      type: 'attribute_mismatch',
      appSpecLocation: appLoc,
      testSpecLocation: testLoc,
      appSpecValue: appValue,
      testSpecValue: testValue,
      resolution: 'unresolved',
    });
  }

  // -------------------------------------------------------------------------
  // String mismatch detection (Bug 5: apply isTemplateMatch before flagging)
  // -------------------------------------------------------------------------

  for (const [testValue, testLocation] of testMap) {
    const isAttribute = testValue.startsWith('data-testid:') || testValue.startsWith('aria-label:');
    if (isAttribute) continue; // Handled above

    const testNorm = testValue.toLowerCase();

    for (const [appValue, appLocation] of appMap) {
      if (testValue === appValue) continue; // Exact match, no mismatch
      const appIsAttribute = appValue.startsWith('data-testid:') || appValue.startsWith('aria-label:');
      if (appIsAttribute) continue;

      const appNorm = appValue.toLowerCase();

      if (
        testNorm.length > 10 &&
        appNorm.length > 10 &&
        testNorm !== appNorm
      ) {
        // Bug 5: skip template-vs-instance pairs
        if (isTemplateMatch(appValue, testValue)) continue;

        // Check if one contains a substantial prefix of the other (likely a mismatch)
        const shorter = testNorm.length < appNorm.length ? testNorm : appNorm;
        const longer = testNorm.length < appNorm.length ? appNorm : testNorm;

        if (longer.startsWith(shorter.slice(0, Math.floor(shorter.length * 0.8)))) {
          mismatches.push({
            type: 'string_mismatch',
            appSpecLocation: appLocation,
            testSpecLocation: testLocation,
            appSpecValue: appValue,
            testSpecValue: testValue,
            resolution: 'unresolved',
          });
          break; // Only report first match per test string
        }
      }
    }
  }

  return mismatches;
}

/**
 * Compute cross-document report after all debate rounds complete (AD-4).
 *
 * alignmentScore: covered behaviors / total behaviors (0.0 - 1.0)
 * mismatches: string and attribute mismatches
 * coverageMatrix: counts and percentage
 */
export function computeCrossDocumentReport(
  refinedAppSpec: string,
  refinedTestSpec: string
): CrossDocumentReport {
  const behaviors = extractAppSpecBehaviors(refinedAppSpec);
  const totalBehaviors = behaviors.length;

  // Avoid division by zero (F-5: if total = 0, score = 1.0)
  if (totalBehaviors === 0) {
    return {
      alignmentScore: 1.0,
      mismatches: [],
      coverageMatrix: {
        appSpecBehaviors: 0,
        testedBehaviors: 0,
        coveragePercent: 100,
      },
    };
  }

  const coveredBehaviors = behaviors.filter(b =>
    isBehaviorCovered(b, refinedTestSpec)
  ).length;

  const alignmentScore = coveredBehaviors / totalBehaviors;
  const mismatches = detectMismatches(refinedAppSpec, refinedTestSpec);
  const coveragePercent = Math.round((coveredBehaviors / totalBehaviors) * 100);

  return {
    alignmentScore,
    mismatches,
    coverageMatrix: {
      appSpecBehaviors: totalBehaviors,
      testedBehaviors: coveredBehaviors,
      coveragePercent,
    },
  };
}
