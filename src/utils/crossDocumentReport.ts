// ============================================================================
// Cross-Document Report - Post-processing alignment analysis (v4.0)
// ============================================================================

import type { CrossDocumentReport, CrossDocumentMismatch } from '../types/index.js';

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

  // Check for values in test spec that are similar but not identical to app spec values
  for (const [testValue, testLocation] of testMap) {
    // Skip attribute-prefixed values for string mismatch detection
    const isAttribute = testValue.startsWith('data-testid:') || testValue.startsWith('aria-label:');

    for (const [appValue, appLocation] of appMap) {
      if (testValue === appValue) continue; // Exact match, no mismatch

      // Check for similar but not identical values (potential mismatch)
      const testNorm = testValue.toLowerCase();
      const appNorm = appValue.toLowerCase();

      // Detect attribute mismatches
      if (isAttribute && testValue.split(':')[0] === appValue.split(':')[0]) {
        const testAttrValue = testValue.split(':').slice(1).join(':');
        const appAttrValue = appValue.split(':').slice(1).join(':');

        if (
          testAttrValue !== appAttrValue &&
          (testAttrValue.includes(appAttrValue) || appAttrValue.includes(testAttrValue))
        ) {
          mismatches.push({
            type: 'attribute_mismatch',
            appSpecLocation: appLocation,
            testSpecLocation: testLocation,
            appSpecValue: appAttrValue,
            testSpecValue: testAttrValue,
            resolution: 'unresolved',
          });
        }
        continue;
      }

      // Detect string mismatches (similar strings with small differences)
      if (
        !isAttribute &&
        testNorm.length > 10 &&
        appNorm.length > 10 &&
        testNorm !== appNorm
      ) {
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
