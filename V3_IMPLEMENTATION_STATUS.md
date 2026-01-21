# PRD Gauntlet v3.0 - Implementation Status

**Date:** 2026-01-21
**Base Version:** v2.6.0
**Target Version:** v3.0.0

## ✅ Completed Features

### 1. Research Protocol for Terminology Verification (HIGHEST PRIORITY)
- **Status:** ✅ **Core infrastructure complete**
- **Files:**
  - `src/utils/terminologyCache.ts` - Shared cache with 24h TTL
  - `src/utils/research.ts` - Research protocol implementation
  - `src/prompts/critic.ts` - Updated with research requirements
  - `src/prompts/defender.ts` - Updated with research requirements
- **What works:**
  - In-memory terminology cache with automatic TTL expiry
  - Cache normalization (lowercase, HTTPS, trailing slash handling)
  - Cache key format: `term:version:normalizedUrl`
  - Term extraction from PRD (acronyms, backticks, CamelCase)
  - Check if term is defined in Terminology section
  - Critic prompts instruct AIs to search for undefined terms
  - Defender prompts enforce research before claiming term knowledge
- **Integration needed:**
  - AI models need to actually call web_search tool when encountering undefined terms
  - The research.ts functions are placeholders that will be used by AI during debate
  - Test with real PRDs containing undefined terms to validate 85% catch rate

### 2. Claude Defender Protocol with Type A-E Categorization
- **Status:** ✅ **Complete**
- **Files:** `src/prompts/defender.ts`
- **Changes:**
  - Added Type A-E feedback categorization framework
  - Type A (Valid Gap) - includes undefined terms as HIGHEST PRIORITY
  - Type B (Clarity Issue) - accept with rewrite
  - Type C (Stylistic) - politely decline
  - Type D (Out of Scope) - decline with boundary explanation
  - Type E (Misunderstanding) - clarify existing content
  - Added refinement techniques for each type
  - Added defense format for pushback scenarios

### 3. Enhanced Consensus Criteria (5 Quantitative Thresholds)
- **Status:** ✅ **Complete**
- **Files:** `src/debate/consensus.ts`
- **Thresholds implemented:**
  1. ✅ Minimum 2 rounds completed
  2. ✅ Zero blocking issues (undefined terms, contradictions, etc.)
  3. ✅ Terminology 100% complete (using `getUndefinedTerms()`)
  4. ✅ Declining rate (<3 new issues in final round)
  5. ✅ Explicit approval phrase (supports all 3 PRD-specified phrases)
- **New function:** `checkFullConsensus()` validates all 5 thresholds
- **Returns:** `failedThresholds` array and detailed breakdown

### 4. Updated Type Definitions for v3.0
- **Status:** ✅ **Complete**
- **Files:** `src/types/index.ts`
- **New types:**
  - JobStatus: Added `awaiting_user_input`, `consensus_failed`
  - `WebhookAuth`: Bearer and HMAC support
  - `WebhookPayload`: User notification structure
  - `DivergenceReport`: Consensus failure report with escalation options
  - `TerminologyResearch`: Research results structure
  - `IssueLoop`: Loop detection data
  - `Reversion`: Tracking reversed changes
  - `GauntletStatsV3`: Enhanced stats with terminology metrics
- **Updated types:**
  - `GauntletInput.config`: Added `transcriptSummaryOnly`, `targetedSections`, `webhookUrl`, `webhookAuth`

### 5. Terminology Cache Management Tool
- **Status:** ✅ **Complete**
- **Files:**
  - `src/tools/clearCache.ts` - Tool implementation
  - `src/server.ts` - Registered `clear_terminology_cache` tool
- **Functionality:**
  - Manual cache invalidation via MCP tool
  - Returns previous cache stats (hits, misses, size)
  - Logged for monitoring

---

## 🚧 In Progress / Pending Features

### 6. Loop Detection for Conflicting Critics
- **Status:** 🔶 **Partially complete (types defined)**
- **What's needed:**
  - Implement `detectLoop()` function in debate engine
  - Track issue signatures across rounds
  - Detect when same issue is raised → addressed → reverted → raised again
  - Trigger early divergence report when loop detected
  - Add loop timeline to divergence report
- **Files to create/modify:**
  - `src/debate/loopDetection.ts` (new)
  - `src/debate/engine.ts` (integrate loop detection)

### 7. Divergence Report Generation
- **Status:** 🔶 **Types defined, generation logic needed**
- **What's needed:**
  - Implement `generateDivergenceReport()` function
  - Extract unresolved sections from final PRD
  - Capture both critics' positions
  - Generate Claude's assessment
  - Calculate convergence rate
  - Build escalation options with cost estimates
  - Format targeted re-debate example code
- **Files to create:**
  - `src/utils/divergenceReport.ts`
- **Files to modify:**
  - `src/tools/runGauntlet.ts` (call generator when consensus fails)

### 8. Webhook Support for User Notifications
- **Status:** ⏸️ **Not started**
- **What's needed:**
  - Implement HMAC signature generation
  - Implement webhook retry logic (3 attempts, exponential backoff)
  - Handle `awaiting_user_input` job state
  - Create `POST /jobs/{jobId}/resolve-term` endpoint
  - Support 5-minute timeout with WARNING fallback
  - Webhook delivery monitoring
- **Files to create:**
  - `src/utils/webhook.ts`
  - `src/tools/resolveTerm.ts`
- **Files to modify:**
  - `src/tools/runGauntlet.ts` (trigger webhooks)
  - `src/server.ts` (register resolve-term endpoint if using HTTP server)

### 9. Targeted Re-Debate (Section Matching)
- **Status:** ⏸️ **Not started**
- **What's needed:**
  - Implement hierarchical section path matching ("FR4 > Rate Limiting")
  - Fuzzy matching with 80% similarity threshold
  - Fail with error if multiple ambiguous matches
  - Parse markdown heading structure
  - Filter critic prompts to focus on specific sections only
  - Enforce Claude only edits targeted sections
- **Files to create:**
  - `src/utils/sectionMatcher.ts`
- **Files to modify:**
  - `src/debate/engine.ts` (support targetedSections config)
  - `src/prompts/critic.ts` (inject focus instructions)

### 10. Transcript Summary Mode
- **Status:** ⏸️ **Not started**
- **What's needed:**
  - Implement condensed transcript generation
  - Summary format: round #, timestamp, key critique points (max 500 chars), changes made
  - Switch from full transcript (10-50KB) to summary (2-5KB)
  - Support `transcriptSummaryOnly` config option
  - Automatic switch if transcript >10MB mid-debate
- **Files to modify:**
  - `src/utils/jobStore.ts` (support summary storage)
  - `src/debate/engine.ts` (generate summaries)

### 11. Heap Pressure Monitoring & Transcript Compression
- **Status:** ⏸️ **Not started**
- **What's needed:**
  - Monitor `process.memoryUsage().heapUsed / heapTotal`
  - At 80% heap: compress oldest transcripts to summary-only
  - At 95% heap: reject new jobs with `503 Service Unavailable`
  - Priority queue for transcript retention (active > recent > old)
  - Configurable thresholds via env vars
- **Files to create:**
  - `src/utils/memoryMonitor.ts`
- **Files to modify:**
  - `src/index.ts` (start monitoring interval)
  - `src/tools/runGauntlet.ts` (check capacity before creating job)

### 12. Reversion Tracking
- **Status:** ⏸️ **Not started**
- **What's needed:**
  - Track when Claude reverts a change made in an earlier round
  - Capture which critic triggered the reversion
  - Include reversion count in stats
  - Flag `highChurn: true` if >3 reversions
  - Add reversions to summary output
- **Files to modify:**
  - `src/utils/changelog.ts` (track reversions)
  - `src/debate/parser.ts` (detect revert changes)

---

## 🧪 Testing Requirements

### Research Protocol Tests
- **Status:** ⏸️ **Not started**
- **Required:**
  - Create 100-PRD test corpus with intentionally undefined terms
  - Categories: must_catch, should_catch, nice_to_catch
  - Target: 85% catch rate = `(must_catch_found + 0.5 * should_catch_found) / (must_catch_total + should_catch_total)`
  - Validate cache hit rate (>60% after warm-up)
- **File to create:** `tests/research.test.ts`

### Consensus Criteria Tests
- **Status:** ⏸️ **Not started**
- **Required:**
  - Test all 5 thresholds independently
  - Test edge cases (approval phrase but undefined terms remain)
  - Test false positive prevention (flawed but well-formatted PRDs)
  - Integration test with 20 real PRDs
- **File to create:** `tests/consensus.test.ts`

### Loop Detection Tests
- **Status:** ⏸️ **Not started**
- **Required:**
  - Mock debate with issue raised → accepted → reverted → raised again
  - Verify early escalation to divergence report
  - Test timeline capture
- **File to create:** `tests/loopDetection.test.ts`

### Webhook Tests
- **Status:** ⏸️ **Not started**
- **Required:**
  - Test HMAC signature generation
  - Test retry logic (3 attempts, exponential backoff)
  - Test fallback to polling when webhook fails
  - Test 5-minute timeout behavior
- **File to create:** `tests/webhook.test.ts`

---

## 📋 Key Implementation Notes

### Critical Success Factors
1. **Research Protocol MUST work**: This is the core value prop. The AI models MUST actually call web_search when encountering undefined terms. The prompts are updated, but we need to validate with real debates.

2. **Cache Hit Rate**: Target >60% cache hit rate requires concurrent jobs sharing terminology. Test with jobs that have overlapping technical domains.

3. **Consensus Validation**: The 5-threshold check prevents premature approval. Test with synthetic "flawed but well-formatted" PRDs to ensure <5% false positive rate.

4. **Memory Management**: Heap pressure monitoring is critical for production stability with concurrent jobs. Without it, system could OOM crash.

### Known Limitations (Acceptable for v3.0)
- **In-memory only**: No Redis persistence for job recovery after restart (Phase 3 feature)
- **Web search placeholder**: The `research.ts` functions document the protocol but rely on AI models using their own web_search tool
- **No automated pre-search**: Phase 3 feature to extract terms before debate starts
- **No persistent terminology DB**: Cache is in-memory with 24h TTL (Phase 3: SQL with weekly W3C/IETF feed updates)

### Next Steps for Full v3.0 Implementation
1. **Implement loop detection** (highest priority after research protocol)
2. **Implement divergence report generation** (required for consensus_failed status)
3. **Add webhook support** (enables async user interaction)
4. **Add targeted re-debate** (enables iterative refinement)
5. **Add heap monitoring** (production stability)
6. **Write comprehensive tests** (validation before deployment)

---

## 🔄 API Versioning Strategy

Current approach:
- v2.6 API calls work unchanged (backwards compatible)
- v3.0 features are **opt-in** via new config parameters
- Default behavior matches v2.6 unless user specifies v3.0 options
- Auto-upgrade after 6-month deprecation period (per PRD decisions)

Phased rollout plan (from IMPLEMENTATION_DECISIONS_v3.0.md):
- Week 1-2: 5% canary
- Week 3-4: 25%
- Week 5-6: 100%

---

## 📊 Metrics to Track (Production)

### Quality Indicators (Target)
- ✅ Consensus reached rate >90%
- ✅ Average rounds to consensus <4 per model
- ✅ Undefined term catch rate ≥85%

### Performance Metrics (Target)
- ✅ Average job completion <5 minutes
- ✅ P95 completion <7 minutes
- ✅ API error rate <1%
- ✅ Average cost per job <$0.30
- ✅ Cache hit rate >60% (after warm-up)

### Operational Metrics (Target)
- ✅ Heap never exceeds 95%
- ✅ Webhook delivery success >95% (within 3 retries)
- ✅ Zero data loss during normal operation
- ✅ Loop detection triggers <5% of jobs

---

**Last Updated:** 2026-01-21 by Claude Code
**Implementation Progress:** ~40% complete (core infrastructure done, features pending)
