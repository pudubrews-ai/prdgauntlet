# Implementation Decisions - Gauntlet v3.0
## PM-Engineering Handoff Document

**Version:** 3.0.0
**Date:** 2026-01-21
**Status:** Ready for Development
**Based on:** [PRD_Gauntlet_v3.0_REFINED.md](PRD_Gauntlet_v3.0_REFINED.md)

---

## Architecture & Implementation Decisions

### 1. Targeted Re-Debate Section Matching

**Decision:** Hierarchical path matching with fuzzy fallback, fail on ambiguity

**Implementation:**
```typescript
interface SectionMatcher {
  matchSection(path: string, prd: ParsedPRD): SectionMatch | AmbiguityError;
}

// Primary: Exact hierarchical match
// "FR4 > Rate Limiting" matches ## FR4 containing ### Rate Limiting
// Path uses > separator for nesting

// Fallback: 80% similarity threshold with fuzzy match
// If multiple matches found → return error
```

**Error Response (Multiple Matches):**
```json
{
  "error": "ambiguous_section_path",
  "message": "Section path 'FR4 > Rate Limiting' matched multiple sections",
  "candidates": ["FR4 > Rate Limiting", "FR4 > Rate Limits"],
  "suggestion": "Please use exact section heading or update PRD to use consistent naming"
}
```

**Rationale:** User clarification preferred over automated guessing when ambiguous.

---

### 2. Transcript Storage Memory Management

**Decision:** Graceful degradation with job prioritization

**Heap Thresholds (Configurable):**
```javascript
const HEAP_WARNING = process.env.HEAP_WARNING_PERCENT || 80;  // Compress transcripts
const HEAP_CRITICAL = process.env.HEAP_CRITICAL_PERCENT || 95; // Reject new jobs

const heapUsedPercent = (process.memoryUsage().heapUsed / process.memoryUsage().heapTotal) * 100;

if (heapUsedPercent > HEAP_CRITICAL) {
  // Return 503 Service Unavailable
  throw new Error('System at capacity, retry in 5 minutes');
}

if (heapUsedPercent > HEAP_WARNING) {
  compressOldestTranscripts(); // Switch to summary-only
}
```

**Behavior by Scenario:**

| Scenario | Behavior |
|----------|----------|
| Multiple jobs exceed heap | Priority queue: Active > recent > old. Force oldest to summary-only at 80% heap |
| Single job >10MB mid-debate | Switch to summary mode for future rounds. Keep existing rounds. Flag: `transcriptTruncated: true` |
| Server restart during active jobs | Jobs LOST (acceptable for v3.0). Status API returns 404. Phase 3: Redis persistence |
| 95% heap reached | Reject new jobs with `503 Service Unavailable`, `retryAfter: 300` |

**Rationale:** Prevents OOM crashes. Graceful degradation over hard failures.

---

### 3. Webhook Authentication

**Decision:** Support Bearer tokens + HMAC (user choice)

**Configuration Options:**
```typescript
interface WebhookConfig {
  url: string;
  auth: {
    type: 'bearer' | 'hmac';
    token?: string;  // Required for bearer
  };
}
```

**HMAC Secret Delivery:**
```json
// Returned in run_prd_gauntlet response when webhookUrl provided
{
  "jobId": "uuid-v4",
  "status": "idle",
  "webhookAuth": {
    "type": "hmac",
    "secret": "wh_sec_abc123...",
    "algorithm": "sha256",
    "headerName": "X-Gauntlet-Signature"
  }
}
```

**Implementation:**
- **Bearer:** Include `Authorization: Bearer {token}` header in webhooks
- **HMAC:** Generate secret on job creation, sign each webhook payload, include `X-Gauntlet-Signature: sha256=...` header

**Not Supporting:** Mutual TLS (deferred to Phase 3)

**Rationale:** Bearer is simple. HMAC prevents spoofing. Most webhook systems support one or both.

---

### 4. Terminology Cache Key Normalization

**Decision:** Normalize URLs, require version for standards, preserve query params by default

**Normalization Rules:**
```javascript
function normalizeUrl(url) {
  return url
    .toLowerCase()
    .replace(/^http:/, 'https:')
    .replace(/\/$/, '')  // Strip trailing slash
    .trim();
  // Query params PRESERVED by default (can be semantic)
}

// Cache key format
const cacheKey = `${term}:${version}:${normalizeUrl(sourceUrl)}`;

// Examples:
// "uuid:4122:https://tools.ietf.org/html/rfc4122"
// "myterm:custom:https://docs.company.com/glossary"
```

**Versioning Rules:**
- Standards MUST have version: `uuid:4122:https://...`
- Custom terms use `custom`: `myterm:custom:https://...`

**Query Param Exception List (Phase 3 Enhancement):**
```javascript
const PARAM_STRIP_DOMAINS = [
  'github.com',  // ?tab=readme irrelevant
  'npmjs.com'    // ?activeTab=versions irrelevant
];
```

**Rationale:** Conservative approach. Query params can indicate format/version. Only strip when confident they're decorative.

---

## User Experience & Edge Cases

### 5. Consensus Failure - Result Retention

**Decision:** 24-hour result retention, no auto-cancel

**Lifecycle:**
- Divergence report results kept in memory for **24 hours** (not 30 min like transcripts)
- Job stays in `consensus_failed` state
- User retrieves via `check_gauntlet_status` anytime within 24 hours
- After 24 hours → `404 Not Found` with message: "Job results expired, please resubmit PRD"

**No Resume in v3.0:**
- User must resubmit full PRD with clarifications
- Phase 3 enhancement: `resume_job` API

**Rationale:** 24 hours provides reasonable time for review without rushing. Resume adds complexity deferred to Phase 3.

---

### 6. Undefined Term User Input Format

**Decision:** Structured JSON with flexible resolution actions

**API Endpoint:** `POST /jobs/{jobId}/resolve-term`

**Request Payload:**
```json
{
  "term": "A2A",
  "resolution": {
    "action": "define" | "skip" | "mark_custom",
    "definition": "Agent2Agent Protocol v1.2",  // required for "define"
    "sourceUrl": "https://a2a-protocol.org/spec",  // optional
    "rationale": "Industry standard for agent communication"  // optional
  }
}
```

**Action Behaviors:**

| Action | Behavior | Final PRD Impact |
|--------|----------|------------------|
| `define` | Add to Terminology section with source | Term appears in Terminology with link |
| `skip` | Flag as "intentionally undefined", continue with WARNING | Listed in `summary.skippedTerms` |
| `mark_custom` | Add as custom term with inline context | Added to Terminology as "custom" |

**Skip Action Detail:**
- System maintains "skipped terms" list for job
- If critic re-flags same term → system intercepts: "Term '[X]' marked as intentionally undefined by user. Proceeding."
- Summary includes:
  ```json
  {
    "summary": {
      "skippedTerms": [
        {"term": "A2A", "reason": "Custom terminology, defined in implementation docs"}
      ]
    }
  }
  ```

**Rationale:** Structured format enables automation. "Skip" option handles genuinely ambiguous cases without blocking progress.

---

### 7. Reversion Conflict Detection

**Decision:** Detect loops, escalate to divergence report early

**Loop Detection Logic:**
```
Round 2: ChatGPT raises Issue A
Round 3: Claude accepts, adds Feature X
Round 4: Gemini argues against Feature X → Claude reverts
Round 5: ChatGPT raises Issue A again

→ System detects: Same issue raised 2+ times, was addressed then reverted
→ Escalate to divergence report immediately (don't wait for maxRounds)
```

**Implementation:**
```typescript
interface IssueTracker {
  issues: Map<string, IssueHistory>;  // key: issue signature (hash of critique)

  detectLoop(issue: Critique): boolean {
    const history = this.issues.get(issue.signature);
    return history && history.addressedCount > 0 && history.revertedCount > 0;
  }
}
```

**Divergence Report Enhancement:**
```json
{
  "divergenceReport": {
    "loopDetected": true,
    "loopDetails": {
      "issue": "Rate limiting approach",
      "timeline": [
        {"round": 2, "critic": "chatgpt", "action": "raised"},
        {"round": 3, "critic": "claude", "action": "accepted"},
        {"round": 4, "critic": "gemini", "action": "rejected"},
        {"round": 5, "critic": "chatgpt", "action": "raised_again"}
      ],
      "recommendation": "Critics fundamentally disagree - manual resolution required"
    }
  }
}
```

**Rationale:** Loops waste tokens and time. Early escalation lets user break the tie.

---

### 8. Output Size Limit Enforcement

**Decision:** Complete current round atomically, then fail

**Flow:**
1. Gemini completes Round 3 critique
2. Claude starts refinement → PRD grows 72KB → 78KB
3. System detects: "Will exceed 75KB limit"
4. Claude **completes refinement** (atomic round completion)
5. Job status → `error`

**Error Response:**
```json
{
  "status": "error",
  "error": "output_size_exceeded",
  "details": {
    "finalSize": "78KB",
    "limit": "75KB",
    "roundCompleted": 3,
    "partialPrd": "# PRD content up to Round 3..."
  },
  "userOptions": [
    "Use partial PRD (complete through Round 3)",
    "Increase size limit via config and resubmit",
    "Split PRD into multiple smaller documents"
  ]
}
```

**Size Limits:**
- Input: 50KB max (hard limit)
- Output: 75KB max (50% growth allowance)
- Configurable for enterprise users

**Rationale:** Atomic completion prevents corrupted state. User receives usable output up to size limit.

---

## Implementation Risk Mitigations

### Risk 1: Cache Normalization - Query Param Conflicts

**Decision:** Preserve query params by default

**Default Behavior:**
```javascript
// Separate cache entries for different query params
"uuid:4122:https://tools.ietf.org/html/rfc4122?format=json"
"uuid:4122:https://tools.ietf.org/html/rfc4122?format=xml"
```

**Phase 3 Enhancement:** Domain-specific exception list
```javascript
const PARAM_STRIP_DOMAINS = ['github.com', 'npmjs.com'];
// Only strip params for domains where we're confident they're non-semantic
```

**Rationale:** Query params can be semantic (format, version). Strip only when certain.

---

### Risk 2: Targeted Re-debate Section Isolation

**Decision:** Full PRD visible, instruction-based focus

**System Prompt for Targeted Mode:**
```
You are reviewing a PRD in TARGETED RE-DEBATE mode.

FOCUS SECTIONS: ["FR4 > Rate Limiting"]

RULES:
- ONLY critique the specified sections
- You MAY reference other sections for context
  Example: "FR4's rate limiting conflicts with FR2's auth model"
- Your critiques must be actionable changes to FR4 ONLY

If you identify issues outside targeted sections:
"This is outside the targeted section, but FYI: [issue]"
```

**Claude's Refinement Scope:**
- Only edits targeted sections (enforced programmatically)
- Can add cross-references to other sections
- If critic demands changes to frozen sections → decline with boundary explanation:
  ```
  "FR2 is outside the targeted re-debate scope. This concern is noted
  but cannot be addressed in this session. Consider a full re-run if
  FR2 requires changes."
  ```

**Monitoring Plan:**
- Track first 20 targeted re-debates
- Measure: % of critiques that violate focus boundaries
- If >20% violation rate → tune prompts or add programmatic filtering

**Rationale:** Full context prevents missing cross-cutting concerns. Instruction-based isolation is flexible.

---

### Risk 3: Webhook Retry Exhaustion

**Decision:** Fallback to polling after max retries

**Retry Flow:**
```
T+0s:   Job hits awaiting_user_input, attempt webhook #1
T+1s:   Retry #1 (failed)
T+3s:   Retry #2 (failed, exponential backoff)
T+7s:   Retry #3 (failed)
T+11s:  All retries exhausted
```

**After Retry Exhaustion:**
- Job stays in `awaiting_user_input` state
- Set flag: `webhookDeliveryFailed: true`
- User polls `check_gauntlet_status` to discover awaiting state
- User responds via `POST /jobs/{jobId}/resolve-term` (same API as webhook flow)

**Timeout Behavior:**
- If no user response within 5 minutes → job continues with WARNING status
- Warning appears in final summary: `unresolvedTerms: ["A2A"]`

**Rationale:** Webhook is convenience, not requirement. Polling is always the fallback.

---

### Risk 4: Cost Calculation Race Conditions

**Decision:** Simple race (last write wins), per-model tracking

**Implementation:**
```javascript
// In-memory, per-model stats
const modelStats = {
  chatgpt: { samples: [], avgTokens: 1000 },
  gemini: { samples: [], avgTokens: 800 }
};

function updateModelStats(model, tokens) {
  // No locking - acceptable race condition
  modelStats[model].samples.push(tokens);

  // Rolling window: keep last 100 jobs
  if (modelStats[model].samples.length > 100) {
    modelStats[model].samples.shift();
  }

  // Recalculate average
  modelStats[model].avgTokens = mean(modelStats[model].samples);
}
```

**Race Condition Impact:**
- Concurrent updates might slightly skew average
- Self-corrects over next few jobs
- Not worth locking overhead for non-critical metric

**Initial Values (Conservative):**
- ChatGPT: 1000 tokens avg (increased from 800 in PRD)
- Gemini: 800 tokens avg
- Buffer: 30% (increased from 20%)

**Auto-tuning:** After 100 jobs, system uses rolling average from real data

**Rationale:** Cost estimation is approximate (±30% buffer). Perfect accuracy not required.

---

### Risk 5: Auto-upgrade Breaking Changes

**Decision:** Phased rollout with monitoring and escape hatch

**Rollout Schedule:**

| Week | Traffic % | Action |
|------|-----------|--------|
| 1-2 | 5% canary | Monitor error rates, latency, user complaints. Manual rollback if issues |
| 3-4 | 25% | Continue monitoring |
| 5-6 | 100% | Auto-upgrade complete |

**Monitoring Metrics:**
- Error rate delta (v3.0 vs v2.6 baseline)
- P95 latency delta
- User complaints via support tickets
- Consensus rate comparison

**Escape Hatch (Emergency Rollback):**
```javascript
// Environment variable for forcing specific users back to v2.6
if (process.env.FORCE_V2_6_USERS) {
  const forcedUsers = process.env.FORCE_V2_6_USERS.split(',');
  if (forcedUsers.includes(userId)) {
    return handleV26Request(req);
  }
}
```

**Breaking Change Safeguards:**
- All v3.0 additions are **optional fields** (superset of v2.6 schema)
- No v2.6 fields removed
- No semantic changes to existing fields
- Integration tests: v2.6 requests against v3.0 endpoints

**Communication Plan:**
- T-90 days: Blog post announcing deprecation
- T-60 days: Email to all API users
- T-30 days: Warning headers in responses: `X-API-Warning: "v2.6 deprecated, auto-upgrade scheduled for [date]"`
- T-0 days: Begin phased rollout (5% canary)
- T+30 days: Review metrics, adjust rollout pace if needed

**Rationale:** Gradual rollout catches issues early. Escape hatch prevents total outage.

---

## Configuration Reference

### Environment Variables

```bash
# Memory Management
HEAP_WARNING_PERCENT=80          # Start compressing transcripts
HEAP_CRITICAL_PERCENT=95         # Reject new jobs

# API Versioning
FORCE_V2_6_USERS=user123,user456 # Emergency rollback for specific users

# Cost Estimation (optional overrides)
CHATGPT_AVG_TOKENS=1000
GEMINI_AVG_TOKENS=800
COST_BUFFER_PERCENT=30

# Query Param Handling (Phase 3)
PARAM_STRIP_DOMAINS=github.com,npmjs.com
```

### Runtime Configuration Schema

```typescript
interface GauntletConfig {
  prdContent: string;                    // REQUIRED
  maxRoundsPerModel?: number;            // Default: 5
  maxTotalTokens?: number;               // Default: unlimited
  maxEstimatedCost?: number;             // Default: unlimited (USD)
  apiTimeoutMs?: number;                 // Default: 600000 (10 min)
  includeTranscripts?: boolean;          // Default: false
  transcriptSummaryOnly?: boolean;       // Default: true
  targetedSections?: string[];           // For re-debates only
  models?: {
    chatgpt?: string;                    // Default: "gpt-4o"
    gemini?: string;                     // Default: "gemini-1.5-pro"
  };
  webhookUrl?: string;
  webhookAuth?: {
    type: 'bearer' | 'hmac';
    token?: string;                      // Required if type=bearer
  };
  sizeLimit?: {
    inputKB?: number;                    // Default: 50
    outputKB?: number;                   // Default: 75
  };
}
```

---

## Testing Requirements

### Unit Tests

**Section Matching:**
- Exact hierarchical match success
- Fuzzy match with 80%+ similarity
- Multiple matches → error with candidates
- Non-existent section → error

**Memory Management:**
- Heap pressure triggers compression at 80%
- New jobs rejected at 95%
- Oldest transcripts compressed first
- Single job >10MB switches to summary mode

**Cache Normalization:**
- URL normalization (lowercase, HTTPS, trailing slash)
- Query params preserved by default
- Version required for standards, "custom" for domain terms

**Loop Detection:**
- Same issue raised → addressed → reverted → raised again = loop
- Early divergence report triggered
- Timeline captured in report

### Integration Tests

**Backwards Compatibility (v2.6 → v3.0):**
- Run 50 synthetic PRDs (10 simple, 20 medium, 15 complex, 5 edge cases)
- Assert: v2.6 requests work unchanged on v3.0 endpoints
- Assert: Response schema is superset (new optional fields OK, removed fields = failure)
- Assert: Consensus rates within 5% of v2.6 baseline

**Webhook Delivery:**
- Success on first attempt
- Retry with exponential backoff on failure
- Fallback to polling after 3 retries
- HMAC signature validation
- Bearer token inclusion

**Targeted Re-debate:**
- Only specified sections edited
- Critics respect focus boundaries (monitor first 20 jobs)
- Cross-references to frozen sections preserved
- Cost estimation accuracy within 30%

### Performance Tests

**Baseline Comparison (v2.6 vs v3.0):**

| Metric | v2.6 Baseline | v3.0 Target | Tolerance |
|--------|---------------|-------------|-----------|
| Avg completion time | 3.2 min | <5 min | +56% |
| P95 completion time | 4.8 min | <7 min | +46% |
| Avg cost per job | $0.18 | <$0.30 | +67% |

**Load Testing Scenarios:**
1. **Single Job Baseline:** 10 sequential jobs, measure avg time
2. **Concurrent Load:** 5 concurrent jobs, verify no cache contention
3. **Cache Effectiveness:** 20 jobs with overlapping terminology, target >60% cache hit rate
4. **Research Overhead:** Compare jobs with 0, 3, 5 unknown terms, measure time delta

**Alerting Thresholds:**
- 3+ consecutive API failures (same provider) → "Provider unhealthy" alert
- Cost per job >2x historical avg → "Cost spike" alert
- <90% consensus rate → "Consensus degraded" alert
- Avg job time >10 min → "Performance degraded" alert (Note: higher than P95 target, intentional)

### Undefined Term Detection Tests

**Test Corpus:** 100 PRDs with intentionally undefined terms

**Categories:**
- `must_catch`: Clear undefined acronyms (e.g., "FHIR" without definition)
- `should_catch`: Likely ambiguous (e.g., "API" without context)
- `nice_to_catch`: Domain jargon (e.g., "k8s")

**Scoring:**
```
catch_rate = (must_catch_found + 0.5 * should_catch_found) /
             (must_catch_total + should_catch_total)

Target: 85%
```

**Test Cases:**
1. Known terms only → critics skip research, faster completion
2. Single unknown term → verify search triggered, source cited
3. Multiple standards → conflict resolution protocol triggered
4. Outdated spec → critic flags and suggests current version
5. Novel/nonsense term → critic demands clarification
6. Cache hit validation → second job with same term uses cache

---

## Deployment Checklist

### Pre-deployment
- [ ] All unit tests passing
- [ ] Integration tests passing with 50-PRD corpus
- [ ] Performance tests meet targets (5 min avg, 7 min P95)
- [ ] Undefined term catch rate ≥85%
- [ ] Backwards compatibility validated (v2.6 requests work)
- [ ] Environment variables configured
- [ ] Webhook auth tested (both Bearer and HMAC)

### Phased Rollout (v2.6 → v3.0 Auto-upgrade)
- [ ] Week 1: 5% canary deployed
  - [ ] Error rate monitored (target: <1% delta)
  - [ ] Latency monitored (target: <10% delta)
  - [ ] User complaints tracked
- [ ] Week 3: 25% rollout
  - [ ] Metrics reviewed, no degradation
- [ ] Week 5: 100% rollout
  - [ ] Deprecation warnings active in v2.6 responses
- [ ] Week 8: Post-rollout review
  - [ ] Consensus rate comparison (target: within 5% of v2.6)
  - [ ] Cost per job comparison (target: <$0.30 avg)

### Monitoring Setup
- [ ] Heap usage dashboard (alert at 80%, 95%)
- [ ] Per-model token usage tracking
- [ ] Cost per job tracking with 2x spike alerts
- [ ] Consensus rate tracking (alert if <90%)
- [ ] Webhook delivery success rate
- [ ] Cache hit rate monitoring (target: >60%)
- [ ] Loop detection frequency

### Documentation
- [ ] API migration guide (v2.6 → v3.0)
- [ ] Webhook setup tutorial (Bearer vs HMAC)
- [ ] Targeted re-debate usage examples
- [ ] Troubleshooting guide (size limits, undefined terms, loops)
- [ ] Cost estimation methodology explained

---

## Open Questions for Engineering

### Architecture Decisions Needed
1. **Transcript Compression Algorithm:**
   - Which fields to strip when converting to summary-only mode?
   - Preserve critique signatures for loop detection?

2. **Section Tree Parsing:**
   - Use markdown parser library (e.g., `remark`) or custom regex?
   - How to handle malformed headings (e.g., missing `#` symbols)?

3. **Loop Detection Signature:**
   - Hash entire critique text or extract semantic key points?
   - False positive tolerance (how strict should matching be)?

4. **Cache Persistence (Phase 3 prep):**
   - In-memory only for v3.0 confirmed, but design for future Redis migration?
   - Schema versioning strategy for cache entries?

### Performance Optimization Opportunities
1. **Parallel Critic Invocation (Phase 3):**
   - Current: Sequential (ChatGPT → Gemini)
   - Future: Parallel (both simultaneously)
   - Engineering estimate for implementation effort?

2. **Pre-flight Term Analysis (v3.1 candidate):**
   - Extract all technical terms before debate starts
   - Present to user for pre-approval
   - Would this actually save time vs. critic-driven research?

### Security Hardening
1. **Prompt Injection Detection:**
   - PRD mentions regex-based detection
   - Recommended patterns to block?
   - Consider third-party library (e.g., `rebuff`)?

2. **Webhook URL Validation:**
   - Block localhost, internal IPs confirmed
   - Should we validate DNS resolution before accepting?
   - SSRF protection: whitelist approach vs. blacklist?

---

## Success Metrics - Acceptance Criteria

### Quality Indicators
- [x] Consensus reached rate >90%
- [x] Average rounds to consensus <4 per model
- [x] Undefined term catch rate ≥85%

### Performance Metrics
- [x] Average job completion <5 minutes
- [x] P95 completion <7 minutes
- [x] API error rate <1%
- [x] Average cost per job <$0.30
- [x] Cache hit rate >60% (after warm-up period)

### Operational Metrics
- [x] Heap never exceeds 95% (triggers rejection)
- [x] Webhook delivery success rate >95% (within 3 retries)
- [x] Zero data loss during normal operation (transcripts preserved for TTL)
- [x] Loop detection triggers <5% of jobs (most debates converge naturally)

---

## Phase 3 / Future Enhancements (Out of Scope for v3.0)

### Deferred to v3.1
1. **Job Resume Capability:** Restore expired jobs with full context
2. **Pre-flight Term Analysis API:** User-facing term extraction before debate

### Deferred to Phase 3
1. **Redis Persistence:** Job recovery after server restart
2. **Parallel Critic Invocation:** Run ChatGPT + Gemini simultaneously
3. **Mutual TLS for Webhooks:** Enhanced security for enterprise
4. **Automated Standards Lookup:** System proactively researches terms before critics review
5. **Persistent Terminology Database:** Weekly updates from W3C/IETF feeds

---

**Document Status:** Complete
**Next Steps:** Engineering team reviews, asks clarifying questions, begins implementation planning
**Point of Contact:** PM (for scope questions), Tech Lead (for architecture decisions)
