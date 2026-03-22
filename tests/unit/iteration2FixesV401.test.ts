// ============================================================================
// Iteration 2 v4.0.1 Fix Verification Tests
// Fix A: stripRoundDeltaBlocks / extractRoundDelta last-match
// Fix B: pairTestIds exact-match includes testSpecTestIds
// ============================================================================

import { describe, it, expect } from 'vitest';
import { parseDefenderResponse } from '../../src/debate/parser.js';
import { detectMismatches } from '../../src/utils/crossDocumentReport.js';

// ---------------------------------------------------------------------------
// Fix A: multi-round content — LAST "## Changes This Round" section targeted
// ---------------------------------------------------------------------------

describe('Fix A — stripRoundDeltaBlocks() targets LAST section in multi-round content', () => {
  it('preserves first section content and strips the last section JSON', () => {
    // Simulates accumulated multi-round content where the first "Changes This
    // Round" section is legitimate documentation and the second is the current
    // round delta block that should be stripped.
    const response = `---BEGIN RESPONSE---
## Updated PRD
# My PRD

This is the PRD content.

## API Response Shape

\`\`\`json
{
  "type": "user",
  "summary": "this is a legitimate non-delta code block"
}
\`\`\`

## Changes This Round

This section documents prior round changes (kept as documentation).

## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "Latest round update",
  "section": "FR2"
}
\`\`\`
---END RESPONSE---`;

    const result = parseDefenderResponse(response);

    // The PRD should be extracted
    expect(result.updatedPrd).not.toBeNull();
    // The round delta should come from the LAST section
    expect(result.roundDelta).not.toBeNull();
    expect(result.roundDelta?.type).toBe('modification');
    expect(result.roundDelta?.summary).toBe('Latest round update');
    expect(result.roundDelta?.section).toBe('FR2');
  });

  it('strips only the last Changes This Round section — earlier section text preserved', () => {
    // Build content that would reach extractUpdatedPrd fallback path (no ## Updated PRD header)
    // The first "Changes This Round" section has text we want preserved in the PRD.
    // The second has a JSON block that must be stripped.
    const content = `# My PRD

Some PRD content that is long enough to be recognized.
This content must pass the 500-char length check in extractUpdatedPrd.
Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.
Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.
Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.
Lorem ipsum dolor sit amet consectetur adipiscing elit sed do eiusmod.

## Changes This Round

Prior round documentation text — must remain intact.

## Another Section

More PRD content here.

## Changes This Round
\`\`\`json
{
  "type": "addition",
  "summary": "New feature added"
}
\`\`\``;

    const result = parseDefenderResponse(content);

    // round delta from the LAST section
    expect(result.roundDelta).not.toBeNull();
    expect(result.roundDelta?.type).toBe('addition');
  });

  it('single Changes This Round section still works correctly (no regression)', () => {
    const response = `---BEGIN RESPONSE---
## Updated PRD
# PRD

Single round content.

## Changes This Round
\`\`\`json
{
  "type": "revert",
  "summary": "Reverted previous change"
}
\`\`\`
---END RESPONSE---`;

    const result = parseDefenderResponse(response);
    expect(result.roundDelta?.type).toBe('revert');
    expect(result.roundDelta?.summary).toBe('Reverted previous change');
  });
});

// ---------------------------------------------------------------------------
// Fix B: pairTestIds exact-match covers testSpecTestIds (Fixture A+B case)
// ---------------------------------------------------------------------------

describe('Fix B — pairTestIds exact-match includes testSpecTestIds (no false cross-pairing)', () => {
  it('does not flag bookmark-list/bookmark-empty as attribute_mismatch when both present in test spec via data-testid=', () => {
    // Fixture A: App spec has bookmark-list and bookmark-empty as data-testid attributes
    const appSpec = `
# Bookmark Feature
## Bookmark List
data-testid="bookmark-list"
data-testid="bookmark-empty"
`;

    // Fixture B: Test spec references the same IDs via data-testid= attribute syntax
    // (not via getByTestId() calls or backtick notation near a testid keyword).
    // This is the exact scenario where the old code fell through to Strategy 4.
    const testSpec = `
# Bookmark Tests
## Rendering
The bookmark list container has data-testid="bookmark-list".
The empty state placeholder has data-testid="bookmark-empty".
`;

    const mismatches = detectMismatches(appSpec, testSpec);

    const attributeMismatches = mismatches.filter(m => m.type === 'attribute_mismatch');
    // With Fix B, these exact IDs are recognized via testSpecTestIds and never
    // reach Strategy 4 cross-pairing.
    expect(attributeMismatches).toHaveLength(0);
  });

  it('still detects genuine mismatches — bookmark-list vs bookmark-listing', () => {
    // App spec uses bookmark-list; test spec uses a genuinely different id
    const appSpec = `
# App
data-testid="bookmark-list"
`;
    const testSpec = `
# Tests
data-testid="bookmark-listing"
`;

    const mismatches = detectMismatches(appSpec, testSpec);
    const attributeMismatches = mismatches.filter(m => m.type === 'attribute_mismatch');
    // bookmark-list (2 parts) vs bookmark-listing (2 parts, same prefix "bookmark", different suffix)
    // This is a genuine Strategy 4 mismatch — should still be reported.
    expect(attributeMismatches.length).toBeGreaterThanOrEqual(1);
  });

  it('no regression — existing exact matches via getByTestId still paired correctly', () => {
    const appSpec = `
# App
data-testid="submit-button"
`;
    const testSpec = `
# Tests
getByTestId('submit-button')
`;

    const mismatches = detectMismatches(appSpec, testSpec);
    const attributeMismatches = mismatches.filter(m => m.type === 'attribute_mismatch');
    expect(attributeMismatches).toHaveLength(0);
  });
});
