# Developer Build Note — Iteration 3

**Date:** 2026-03-21
**Branch:** feat/v4.0.0-build-spec-review
**Commit:** 292da92

---

## Summary

All 4 priority defects (D8 Critical, D9 High, D10 High, D11 Medium) implemented and verified. All 3 low-priority cleanup items (L1, L2, L3) also completed. Build passes zero errors, all 229 tests pass.

---

## Defects Fixed

### D8 (Critical) — `check_gauntlet_status` incomplete results

**Files changed:** `src/tools/checkStatus.ts`, `src/types/index.ts`, `src/tools/reviewBuildSpecs.ts`

`checkStatus.ts` was entirely rewritten for the terminal status branch. The old code had a single `if (job.status === 'complete')` block that returned `partialResult.currentPrd` (wrong field, wrong wrapper). The new code:

1. Merges `complete` and `consensus_failed` into one unified branch: `if ((job.status === 'complete' || job.status === 'consensus_failed') && job.result)`
2. Detects `job.jobType` and returns the correct shape:
   - `prd_refinement`: `{ refinedPrd, summary, divergenceReport?, cdrFailureReasons? }`
   - `build_spec_review`: `{ refinedAppSpecSection, refinedTestSpec, summary, crossDocumentReport, divergenceReport?, cdrFailureReasons? }`
3. No `partialResult` in terminal status responses
4. `partialResult` retained only for `debating_chatgpt` / `debating_gemini` (no regression)

`StatusOutput` type updated with 7 new optional fields: `refinedPrd`, `refinedAppSpecSection`, `refinedTestSpec`, `summary`, `crossDocumentReport`, `divergenceReport`, `cdrFailureReasons`.

`BuildSpecReviewOutput` updated with `cdrFailures?: string[]`. `reviewBuildSpecs.ts` now persists `cdrFailures` on the output object when the CDR gate fails (via spread: `...(cdrGateFailed && { cdrFailures })`), so `checkStatus.ts` can surface them as `cdrFailureReasons`.

### D9 (High) — `finalPrd` → `refinedPrd` in public API

**File changed:** `src/tools/getSavedPrd.ts`

`GetSavedPrdResult` interface: renamed `finalPrd?` → `refinedPrd?`. Return statement: `finalPrd` key renamed to `refinedPrd`. Also hardened the `metadata` fields to use optional chaining (`output.stats?.totalRounds`) since spec review jobs loaded via this path have `summary` not `stats`.

Note: Per instructions, the internal `GauntletOutput.finalPrd` field is **not** renamed — only the public API response field.

### D10 (High) — `get_debate_transcript` disk fallback

**Files changed:** `src/tools/getTranscript.ts`, `src/server.ts`

`handleGetTranscript` converted from synchronous to `async`. Added `loadJobFromDisk` import. When `jobStore.get(jobId)` returns null (job not in memory), the code now attempts `loadJobFromDisk(jobId)`:
- If saved job has `debates[model]`: returns transcript from disk
- If saved job has `debates` but not the requested model: returns `TRANSCRIPT_UNAVAILABLE` with model-specific message
- If saved job has no `debates` at all: returns `TRANSCRIPT_UNAVAILABLE` with "run again with includeTranscripts: true" message
- If disk load fails or job not on disk: falls through to `JOB_NOT_FOUND`

`server.ts` updated to `await handleGetTranscript(params)`.

Existing tests updated from synchronous calls to `await` throughout.

### D11 (Medium) — `stats` vs `summary` in `load_saved_job`

**File changed:** `src/utils/jobPersistence.ts`

`loadJobFromDisk` now normalizes legacy PRD jobs: after loading, if `output.summary` is absent and `output.stats` is present, it synthesizes a `summary` object:
```typescript
summary = {
  totalRounds: stats.totalRounds,
  chatgptRounds: 0,  // not available in legacy format
  geminiRounds: 0,
  consensusReached: output.consensusReached ?? false,
  totalTokens: stats.tokensUsed.claude + chatgpt + gemini,
  estimatedCost: stats.estimatedCost,
}
```
All callers (`load_saved_job`, `get_saved_prd`, `check_gauntlet_status`) benefit automatically since they all use `loadJobFromDisk`.

---

## Low-Priority Cleanup

- **L1:** `save_job_output` — `z.string().min(1)` → `z.string().uuid()` for `jobId`
- **L2:** `GauntletOutput` — removed `webhookSecret?: string` from interface
- **L3:** `BuildSpecReviewOutput` — removed `webhookSecret?: string` from interface; removed `webhookSecret` from `SpecReviewDebateParams` interface and call site in `runSpecReviewDebate`

L4 (issuesFoundLimitations string) was not implemented — it's labeled as informational-only and low-risk to defer.

---

## Tests

Added `tests/unit/iteration3Fixes.test.ts` with 15 new tests:

- D8: 7 tests covering complete PRD, complete spec review, consensus_failed PRD, consensus_failed spec review (with/without cdrFailures), and in-progress regression guard
- D9: 2 tests verifying interface shape and field naming
- D10: 4 tests covering JOB_NOT_FOUND fallback, disk transcript retrieval (mocked), TRANSCRIPT_UNAVAILABLE when no debates on disk, in-memory regression guard
- D11: 2 tests verifying summary normalization and load_saved_job summary field presence

Updated existing tests:
- `tests/unit/checkStatus.test.ts` — "returns final PRD" now expects `refinedPrd` (not `partialResult.currentPrd`)
- `tests/unit/getTranscript.test.ts` — all 6 tests converted to async/await
- `tests/unit/iteration2Fixes.test.ts` — "includes jobType in completed status" now also asserts `refinedPrd` present

**Final test count:** 229 tests, all passing (was 214).

---

## Build Results

```
npm run build   → 0 TypeScript errors
npm run lint    → 0 errors (tsc --noEmit)
npm run test:run → 229/229 tests passed
```

---

TOKEN ESTIMATE
  Input:  ~22,000 tokens  (files read: checkStatus.ts, getSavedPrd.ts, getTranscript.ts, types/index.ts, jobPersistence.ts, reviewBuildSpecs.ts, server.ts, loadSavedJob.ts, checkStatus.test.ts, getTranscript.test.ts, iteration2Fixes.test.ts, developer-instructions-3.md)
  Output: ~8,000 tokens
  Total:  ~30,000 tokens
