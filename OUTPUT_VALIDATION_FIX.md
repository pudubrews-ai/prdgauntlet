# Output Validation Fix - PRD Gauntlet v4.0

## Problem Statement

The PRD Gauntlet was **lying** about job completion status. It would mark jobs as `status: "complete"` even when the final PRD was truncated mid-sentence or incomplete.

### Real-World Example

**Job**: `4f268bbd-2145-4e68-8a79-56f06cdad223`
- **Status returned**: `"complete"` ✅ (FALSE)
- **Actual PRD ending**:
  ```typescript
  for (const error
  ```
- **Size**: 34KB (expected ~100KB+ for complete PRD)
- **Problem**: Truncated in the middle of TypeScript code
- **User impact**: Received corrupt, unusable output with no warning

## Root Cause

The system had **zero validation** of output quality:
1. Debate engine completed all rounds
2. System assumed `finalPrd` was complete
3. Job marked as `complete` regardless of content
4. No checks for truncation, incomplete markdown, or corrupt output

## The Fix

### New Validation System

Added `validatePrdCompleteness()` that runs **before** marking any job as complete.

#### Detection Rules

1. **Incomplete Code Patterns** (HIGH PRIORITY)
   - `for (const variable` ← incomplete for loop
   - `function name(param` ← function without closing paren
   - `interface Config {` ← interface without closing brace
   - `{ "key":` ← object literal without closing brace

2. **Markdown Structure Issues**
   - Unclosed code blocks (odd number of `````)
   - Orphaned headings (heading at end with no content)
   - Empty list items at end (`- ` with nothing after)

3. **Truncation Indicators**
   - Trailing ellipsis (`...` at end, not in code)
   - Incomplete markdown tables (row without closing `|`)

4. **Minimum Structure**
   - Has at least one `##` heading (basic PRD structure)
   - Non-empty document

### New Job Status

**Added**: `incomplete_output`
- Used when job completes but PRD fails validation
- Replaces misleading `complete` status
- Included in `unresolvedConcerns` with diagnostic details

### Implementation Flow

```
Debate completes
    ↓
validatePrdCompleteness(finalPrd)
    ↓
┌─────────────┐
│ Is valid?   │
└─────────────┘
    ↙     ↘
  YES      NO
   ↓        ↓
complete  incomplete_output
   ↓        ↓
 status=   status=
'complete' 'incomplete_output'
           +diagnostics
```

### Code Changes

#### src/utils/prdValidation.ts (NEW)
```typescript
export function validatePrdCompleteness(prd: string): PrdValidationResult {
  // Checks:
  // 1. Truncation patterns (incomplete code)
  // 2. Markdown structure (unclosed blocks)
  // 3. Minimum structure (has headings)

  return {
    isValid: boolean,
    issues: string[],
    diagnostics: {
      endsCleanly: boolean,
      hasValidMarkdown: boolean,
      hasMinimumSections: boolean,
      lastContent: string,  // Last 200 chars for debugging
      truncationIndicators: string[],
    }
  };
}
```

#### src/debate/engine.ts
```typescript
// Before returning result:
const validationResult = validatePrdCompleteness(currentPrd);

if (!validationResult.isValid) {
  logger.logError('PRD validation failed - output is incomplete', {...});

  outcome = 'incomplete_output';  // Override outcome

  unresolvedConcerns.push(
    'PRD Validation Failed - Output is Incomplete',
    ...validationResult.issues,
    formatValidationError(validationResult)
  );
}

return {
  finalPrd: currentPrd,
  outcome,  // Now: 'incomplete_output' if validation failed
  prdValidation: validationResult,  // Diagnostics included
  // ...
};
```

#### src/tools/runGauntlet.ts
```typescript
// Check if any debate produced incomplete output
const hasIncompleteOutput = Object.values(debates).some(
  (d) => d && d.outcome === 'incomplete_output'
);

// Determine final job status
let finalStatus: JobStatus = 'complete';
if (hasIncompleteOutput) {
  finalStatus = 'incomplete_output';
} else if (consensusFailed) {
  finalStatus = 'consensus_failed';
}

// Pass status to job store
jobStore.complete(jobId, output, finalStatus);
```

#### src/types/index.ts
```typescript
export type JobStatus =
  | 'idle'
  | 'debating_chatgpt'
  | 'debating_gemini'
  | 'complete'
  | 'consensus_failed'
  | 'incomplete_output'    // NEW
  | 'error';

export interface DebateResult {
  outcome: 'consensus' | 'max_rounds' | 'early_stop' | 'incomplete_output';  // Added
  prdValidation?: PrdValidationResult;  // NEW - validation diagnostics
  // ...
}
```

## Test Coverage

### New Tests (15 tests)

**tests/unit/prdValidation.test.ts**

1. **Valid PRDs** - Should pass
   - Complete PRD with all sections
   - PRD ending with code block
   - Simple PRD with basic structure

2. **Incomplete Code** - Should fail
   - `for (const error` ← Real failure case from job 4f268bbd
   - `function test(param` ← Incomplete function
   - `interface Config {` ← Incomplete interface

3. **Markdown Issues** - Should fail
   - Unclosed code blocks
   - Orphaned headings
   - Empty list items

4. **Truncation Indicators** - Should fail
   - Trailing `...`
   - Incomplete markdown tables

5. **Edge Cases**
   - Empty PRD - Should fail
   - No headings - Should fail
   - Terminal sections (Appendix) - Should pass

### Test Results

```
✓ tests/unit/prdValidation.test.ts (15 tests)
✓ All other existing tests (119 tests)
─────────────────────────────────
Total: 134 tests passing
```

## Verification

### Job 4f268bbd Would Now Be Caught

**Before fix**:
```json
{
  "jobId": "4f268bbd-...",
  "status": "complete",
  "finalPrd": "...for (const error"
}
```

**After fix**:
```json
{
  "jobId": "4f268bbd-...",
  "status": "incomplete_output",
  "finalPrd": "...for (const error",
  "unresolvedConcerns": [
    "PRD Validation Failed - Output is Incomplete",
    "PRD ends with incomplete code: for (const variable",
    "Unclosed code block detected (found 1 triple-backtick markers, expected even number)",
    "\nDiagnostics:\n- Ends cleanly: No\n- Valid markdown: No\n...",
    "\nRecommendation: Increase maxTokens, reduce PRD scope, or split into multiple documents."
  ],
  "prdValidation": {
    "isValid": false,
    "issues": [...],
    "diagnostics": {
      "endsCleanly": false,
      "hasValidMarkdown": false,
      "lastContent": "...for (const error",
      "truncationIndicators": ["incomplete code"]
    }
  }
}
```

## Benefits

1. **Honesty**: System now admits when output is incomplete
2. **Diagnostics**: Clear error messages explain what's wrong
3. **Debuggability**: Last 200 chars + specific issues help diagnose problems
4. **Prevention**: Catches truncation before user wastes time on corrupt output
5. **Guidance**: Recommends fixes (increase maxTokens, reduce scope)

## Impact on Users

### Before
- ❌ Job says "complete" but PRD is garbage
- ❌ User discovers corruption only when trying to use PRD
- ❌ No indication of what went wrong
- ❌ No guidance on how to fix

### After
- ✅ Job status honestly reflects incomplete output
- ✅ Clear error messages list specific issues
- ✅ Diagnostics show exactly where truncation occurred
- ✅ Recommendations provided for resolution

## Configuration

No configuration needed - validation runs automatically on all job completions.

## Performance

- **Overhead**: <10ms per validation (runs once per job)
- **Cost**: Zero additional API calls
- **Memory**: Minimal (checks only last 500 chars for patterns)

## False Positives

Validation is designed to be **conservative**:
- ✅ Passes valid PRDs that end cleanly
- ✅ Allows terminal sections like "Appendix" without content
- ✅ Only flags obvious truncation patterns
- ⚠️ If validation incorrectly fails on valid PRD, please report issue with PRD content

## Future Enhancements

Potential improvements (not implemented):
1. Semantic validation (check if sections make sense)
2. Completeness scoring (0-100% complete)
3. Automatic retry with increased maxTokens
4. PRD repair attempts (fill in truncated sections)

## Summary

The gauntlet now **fails honestly** instead of lying about job completion. When a PRD is truncated or incomplete, the system:
1. Detects it immediately
2. Marks job as `incomplete_output`
3. Provides detailed diagnostics
4. Recommends fixes

This prevents users from receiving corrupt output labeled as "complete".
