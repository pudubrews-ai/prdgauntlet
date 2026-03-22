# Developer Build Note — Iteration 2

**Date:** 2026-03-21
**Branch:** feat/v4.0.0-build-spec-review
**Commit:** 2a0237d

---

## What Was Fixed

### D2 (Critical) — `run_prd_gauntlet` now returns immediately
- **File:** `src/tools/runGauntlet.ts`
- **Change:** Extracted all debate logic into `runPrdDebate()` helper. `handleRunGauntlet` now returns `{ jobId, status: 'idle', jobType: 'prd_refinement', webhookSecret? }` immediately after job creation, then calls `setImmediate(async () => runPrdDebate(...))`.
- **Pattern:** Matches `reviewBuildSpecs.ts` exactly (lines 208-238 of that file).
- **Return type:** Changed from `Promise<GauntletOutput | GauntletError>` to `Promise<{ jobId: string; status: string; jobType: string; webhookSecret?: string } | GauntletError>`.

### D1 (Critical) — `stats` renamed to `summary` with full field set
- **Files:** `src/types/index.ts`, `src/tools/reviewBuildSpecs.ts`, `src/tools/runGauntlet.ts`
- **New type:** `OutputSummary` interface added to `src/types/index.ts` with all required fields: `totalRounds`, `chatgptRounds`, `geminiRounds`, `consensusReached`, `totalTokens`, `estimatedCost`, optional `issuesFound` (for spec review), `totalIssuesFound`, `totalIssuesResolved`, `unresolvedIssues`, `terminologyResearched`, `cacheHits`, `cacheMisses`.
- **`BuildSpecReviewOutput`:** Now has `summary: OutputSummary` as primary field; `stats` retained as optional deprecated alias for backward compatibility.
- **`GauntletOutput`:** `summary?: OutputSummary` added alongside existing `stats` field (kept for backward compat with legacy disk files).
- **`computeIssuesFound()`:** Helper function added in `reviewBuildSpecs.ts` that classifies changelog entries heuristically and reads CDR data for cross-document counts.
- **`getRounds()`:** Local helper in `runSpecReviewDebate` handles `DebateSummary | DebateTranscript` union when reading round counts.

### D6 (Security) — `webhookSecret` not stored on in-memory job
- **File:** `src/tools/runGauntlet.ts`
- **Change:** `runPrdDebate()` builds `GauntletOutput` without `webhookSecret`. The secret is only in the immediate response returned by `handleRunGauntlet`. The disk save now writes the output directly (no need to strip, since it was never added). This matches the `reviewBuildSpecs.ts` pattern where the secret is captured in closure and never set on `output`.

### D3 (High) — `jobType` in every `check_gauntlet_status` response
- **Files:** `src/types/index.ts`, `src/tools/checkStatus.ts`
- **Change:** `StatusOutput.jobType?: JobType` added to the interface. All three return paths in `handleCheckStatus` (base response, complete path, error path) now include `jobType: job.jobType`.

### D7 (High) — CDR gate enforcement in `reviewBuildSpecs.ts`
- **File:** `src/tools/reviewBuildSpecs.ts`
- **Change:** After `computeCrossDocumentReport()`, three gate checks run:
  1. `crossDocumentReport.alignmentScore < 0.90` → failure
  2. `stringMismatches > 0` (where type === 'string_mismatch') → failure
  3. `untestedBehaviors > 0` (appSpecBehaviors − testedBehaviors) → failure
- If any gate fails, `finalStatus` is forced to `'consensus_failed'` regardless of debate outcomes. Failures are logged via `logger.logInfo`.

### D4 (High) — `list_saved_jobs` enriched metadata
- **Files:** `src/utils/jobPersistence.ts`, `src/tools/listSavedJobs.ts`
- **Change:** `listSavedJobs()` return type expanded to include `jobType`, `status`, `title`, `createdAt`, `completedAt`, `consensusReached`, `savedToDisk: true`.
- **Derivation logic:** `status` and `consensusReached` are read from persisted fields (`.status`, `.consensusReached`) added to output objects by D1/D4. Fallback heuristics: presence of `divergenceReport` → `consensus_failed`; debate `outcome === 'consensus'` check for `consensusReached`.
- Both `reviewBuildSpecs.ts` and `runGauntlet.ts` now persist `.status` and `.consensusReached` on saved output objects.

### D5 (Medium) — `save_job_output` accepts `consensus_failed`
- **File:** `src/tools/saveJobOutput.ts`
- **Change:** Replaced `if (job.status !== 'complete' && job.status !== 'error')` with `const TERMINAL_STATUSES = new Set(['complete', 'error', 'consensus_failed', 'incomplete_output'])`.

---

## Build Status

```
npm run build   → PASS (zero TypeScript errors)
npm run lint    → PASS (tsc --noEmit, zero errors)
npm run test:run → PASS (214 tests, 15 test files)
```

---

## Test Status

- **Before:** 192 tests across 14 test files
- **After:** 214 tests across 15 test files (+22 new tests)
- **New test file:** `tests/unit/iteration2Fixes.test.ts`
- **Coverage of new tests:**
  - D3: 5 tests (jobType in idle, build_spec_review, debating, complete, error statuses)
  - D5: 6 tests (rejects idle, debating; accepts consensus_failed, incomplete_output, complete, error)
  - D2: 2 tests (schema contract verification)
  - D1: 2 tests (OutputSummary shape, spec review extended fields)
  - D7: 6 tests (alignment gate, string mismatch gate, untested behavior gate, all-pass, CDR downgrade)
  - D6: 1 test (no webhookSecret on stored job result)

---

## Ambiguities and Flags

1. **`GauntletOutput.stats` retained:** Per D1 instructions, `stats` is kept as the existing field in `GauntletOutput` (PRD path); `summary` is added alongside it. This maintains backward compatibility with disk-saved jobs that only have `stats`. `BuildSpecReviewOutput` uses `summary` as the primary field and `stats` as optional deprecated alias.

2. **`terminologyResearched` in OutputSummary:** The instructions list this as an optional PRD-mode field. The current codebase uses `getTerminologyCacheStats()` for cache hits/misses, but does not track which specific terms were researched in a string array. The field is defined on the interface but not populated in this iteration (value is `undefined`). This matches the "best-effort" guidance in D1.

3. **`computeIssuesFound` categorization:** Changelog entries are classified by keyword heuristics. The categories `buildability`, `completeness`, `ambiguity`, `consistency` (app spec) and `testability`, `coverageGaps`, `testQuality`, `specAlignment` (test spec) are approximated. The spec's guidance acknowledges this is best-effort. Cross-document counts come directly from CDR data and are precise.

4. **`server.ts` not updated:** The instructions noted updating `server.ts` to handle the new return shape. The existing handler code in `server.ts` already handles the new shape correctly — it just checks `'error' in result` and returns the result as JSON. Since the immediate response `{ jobId, status, jobType }` does not have an `error` property, it correctly takes the success path. No changes needed.

5. **D4 `completedAt` field:** Neither `runGauntlet.ts` nor `reviewBuildSpecs.ts` sets `completedAt` on the output object (the `JobState` has `completedAt` but it is not set by `complete()`). This field will be `undefined` in listed metadata. This is a pre-existing limitation not introduced by this iteration.

---

TOKEN ESTIMATE
  Input:  ~38,000 tokens  (files read: developer-instructions-2.md, src/types/index.ts, src/tools/runGauntlet.ts, src/tools/reviewBuildSpecs.ts, src/tools/checkStatus.ts, src/tools/saveJobOutput.ts, src/utils/jobPersistence.ts, src/tools/listSavedJobs.ts, src/server.ts, src/utils/jobStore.ts, tests/unit/engine.test.ts, tests/unit/reviewBuildSpecs.test.ts, tests/unit/checkStatus.test.ts, tests/unit/listJobs.test.ts)
  Output: ~14,000 tokens
  Total:  ~52,000 tokens
