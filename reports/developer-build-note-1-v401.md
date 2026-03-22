# Developer Build Note — Gauntlet v4.0.1

**Date:** 2026-03-22
**Author:** Developer Agent
**Branch:** fix/v4.0.1-bug-fixes (branched from feat/v4.0.0-build-spec-review)
**Commit:** f178e26

---

## Build Status

- `npm run build` — PASS (zero TypeScript errors)
- `npm run test:run` — PASS (238 tests, 17 test files)
- `npm run lint` — PASS (tsc --noEmit, zero errors)

Baseline before changes: 238 tests passing. No regressions introduced.

---

## Bugs Fixed

### Bug 6 — Health endpoint version string (trivial)

**File:** `src/tools/health.ts` line 22

Changed `VERSION = '3.0.0'` to `'4.0.1'`. One-line change.

---

### Bug 5 — Template vs instance flagged as string mismatch

**File:** `src/utils/crossDocumentReport.ts`

Added `isTemplateMatch(a, b)` above `detectMismatches()`. Implementation:
- Allowlisted placeholder pattern: `/\{(?:n|N|id|index|i|[0-9])\}/g` — no catch-all `{word}`
- `escapeRegExp()` applied to all non-placeholder literal segments before `new RegExp()` (S1)
- Placeholder replaced with `[^-]+` (single hyphen-delimited segment, not `.+`) (S2)
- Cap at 3 placeholders per value (S3)
- Skip values longer than 100 characters (S4)
- Full regex anchored with `^...$`
- Example: `cafe-item-{n}` → `/^cafe\-item\-[^-]+$/` → matches `cafe-item-1`, `cafe-item-42`

`isTemplateMatch()` is exported for test coverage.

---

### Bug 4 — Cross-document testid mismatch too aggressive

**File:** `src/utils/crossDocumentReport.ts`

Added `pairTestIds(appTestIds, testSpecTestIds, testSpecRaw)` function. Strategies in order:

1. **Backtick extraction** — backtick-quoted values on lines containing "testid"/"test-id"/"data-testid"
2. **Markdown table extraction** — column values under a header containing "testid" or "test id"
3. **`getByTestId()` extraction** — extracts values from `getByTestId('...')` or `getByTestId("...")`
4. **Unpaired fallback** — only flag when both IDs have the same depth AND same prefix up to last segment, and last segments differ (`cafe-item-name` vs `cafe-item-label` → flagged; `cafe-map` vs `cafe-map-popup` → NOT flagged)

Replaced the old `testAttrValue.includes(appAttrValue) || appAttrValue.includes(testAttrValue)` check entirely.

---

### Bug 3 — Response body JSON code blocks stripped from refined output

**File:** `src/debate/parser.ts`

Added `stripRoundDeltaBlocks(content)` function before `extractUpdatedPrd()`. Implementation:
- Uses section-header anchoring: matches `## Changes This Round` (case-insensitive, `##` or `###`) to next `##`-level header or end of string
- Strips `json` code blocks ONLY within that matched section
- Returns content unchanged if no `## Changes This Round` section exists
- All other code blocks (API response shape examples, etc.) are preserved intact (S6)

The fallback path in `extractUpdatedPrd()` now calls `stripRoundDeltaBlocks()` instead of the blanket `jsonBlockPattern` replace.

---

### Bug 2 — `totalIssuesResolved` always 0

**Files:** `src/prompts/specReviewDefender.ts`, `src/debate/engine.ts`, `src/tools/reviewBuildSpecs.ts`

**2a — Defender prompt:** Added `## CHANGELOG FORMAT — MANDATORY` section to `buildSpecReviewDefenderPrompt()`, placed before the CONSENSUS section and before any metadata interpolation. Instructs defender to emit `## Changes This Round` JSON array after each round. Uses synthetic placeholder descriptions in the example per CISO Finding 3. (S8)

**2b — No synthetic fallback (S7):** In `engine.ts` debate loop, when `parsed.roundDelta` is null but the document changed, a `logger.logWarn()` is emitted. No synthetic `{ type: 'modification', summary: '...' }` entry is created. Accurate 0 beats a synthetic non-zero count.

**2c — Clarifying comment:** Added comment to `reviewBuildSpecs.ts` lines around `totalIssuesResolved` explaining that it counts only explicit defender-documented resolutions. Retained formula unchanged.

---

### Bug 1 — Gemini never runs

**Files:** `src/tools/runGauntlet.ts`, `src/tools/reviewBuildSpecs.ts`, `src/utils/jobPersistence.ts`

**1a — Split stoppedEarly:** Replaced `let stoppedEarly` boolean/object with `let resourceCapExhausted: { reason: 'cost_cap' | 'token_cap'; details: string } | null`. ChatGPT `early_stop` due to protocol violation, timeout, or other reasons does NOT set `resourceCapExhausted` and does NOT gate Gemini. Only `cost_cap` or `token_cap` outcomes (verified via `costTracker.hasExceededCostCap()` / `costTracker.hasExceededTokenCap()`) trigger the gate. Applied to both `runGauntlet.ts` and `reviewBuildSpecs.ts`.

**1b — Dual-critic failure → error (S10):** After both critic blocks complete, check if `allCriticsFailed` (all debates have `early_stop` or `error` outcome AND no skippedCritics). If true, `finalStatus = 'error'`. This distinguishes "critics disagreed" (`consensus_failed`) from "both debates crashed" (`error`). Applied to both tools.

**1c — Backward-compat shim (S9):** In `loadJobFromDisk()`, after the existing `jobType` default, added shim: if `output.stats.stoppedEarly` is a `boolean`, normalize to `null` (legacy v3.x format). v4.0.0 object format is shape-compatible with new code — no action needed for that case.

**1d — Cost starvation visibility:** After Gemini block, if `resourceCapExhausted` and Gemini completed ≤1 round, push a note to `summary.notes` informing the user Gemini was limited due to cost/token cap. Applied in `runGauntlet.ts`.

---

## Files Changed

| File | Bugs | Summary |
|------|------|---------|
| `src/tools/health.ts` | 6 | Version string → `'4.0.1'` |
| `src/utils/crossDocumentReport.ts` | 4, 5 | Added `isTemplateMatch()`, `pairTestIds()`, replaced `includes()` check |
| `src/debate/parser.ts` | 3 | Added `stripRoundDeltaBlocks()`, section-header-anchored JSON stripping |
| `src/prompts/specReviewDefender.ts` | 2 | Added `## CHANGELOG FORMAT` block before metadata interpolation |
| `src/debate/engine.ts` | 2 | Warning log when roundDelta null; no synthetic entry |
| `src/tools/reviewBuildSpecs.ts` | 1, 2 | resourceCapExhausted replaces stoppedEarly; dual-failure check; comment |
| `src/tools/runGauntlet.ts` | 1 | resourceCapExhausted, dual-failure check, cost starvation note |
| `src/utils/jobPersistence.ts` | 1 | Backward-compat shim for legacy stoppedEarly boolean |

---

## Security Requirements Met

| # | Requirement | Status |
|---|-------------|--------|
| S1 | `escapeRegExp()` on all non-placeholder segments before `new RegExp()` | Done |
| S2 | `[^-]+` not `.+` for placeholder replacement | Done |
| S3 | Limit template placeholder count to 3 per value | Done |
| S4 | Limit template string length to 100 chars | Done |
| S5 | Allowlisted placeholders only | Done |
| S6 | Section-header anchoring for JSON stripping | Done |
| S7 | No synthetic fallback changelog entries | Done |
| S8 | Changelog format instructions before metadata interpolation | Done |
| S9 | Backward-compat shim for legacy stoppedEarly | Done |
| S10 | Dual-critic failure → error status | Done |

---

## Decisions Made

- **Bug 5 placeholder replacement:** Used `[^-]+` per instructions (not `.+`). This also means `cafe-item-{n}` matches `cafe-item-42` but NOT `cafe-item-sub-menu` (contains a hyphen). This is intentional — the instructions specify hyphen-delimited segment matching.
- **Bug 1 `stoppedEarly` stats field:** Kept the legacy `stats.stoppedEarly` object shape on `GauntletOutput.stats` (using `stoppedEarlyStats` local variable) so no type changes were needed in `types/index.ts`. The `GauntletStats.stoppedEarly` type already accommodates the object shape.
- **Bug 1 `allCriticsFailed` scope:** Used `Object.keys(debates).length > 0` guard to avoid triggering on jobs where no critics ran at all (both skipped). Matches the instructions: "if BOTH critics fail (not just one)".

---

TOKEN ESTIMATE
  Input:  ~18,000 tokens  (files read: gauntlet-app-spec.md, developer-instructions-1-v401.md, health.ts, crossDocumentReport.ts, parser.ts, specReviewDefender.ts, engine.ts, runGauntlet.ts, reviewBuildSpecs.ts, types/index.ts, jobPersistence.ts, specReviewParser.ts [lines 1-30], crossDocumentReport.test.ts)
  Output: ~9,000 tokens
  Total:  ~27,000 tokens
