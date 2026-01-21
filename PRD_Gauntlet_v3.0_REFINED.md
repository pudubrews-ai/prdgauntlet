# PRD: Multi-Model PRD Gauntlet v3.0

## Product Overview
An MCP server that orchestrates multi-model PRD refinement through structured debates between ChatGPT and Gemini critics. Claude facilitates iterative improvement of Product Requirements Documents by having different AI models critique and refine content until consensus is reached.

## Target User Profile
**Primary User:** Technical Product Managers and Engineering Leads

**User Characteristics:**
- Responsible for writing and maintaining technical product specifications
- Familiar with software development lifecycle and technical terminology
- Makes final decisions on feature scope and implementation approach
- Has authority to resolve ambiguous requirements
- Comfortable evaluating conflicting technical recommendations

**Expected Interaction Pattern:**
- User submits initial PRD draft
- Reviews system-generated terminology clarifications and approves/modifies definitions
- Receives final refined PRD with improvement summary
- May need to resolve conflicts when AI critics disagree (consensus failure scenarios)

**Not Intended For:**
- Non-technical stakeholders who cannot evaluate technical trade-offs
- Fully automated PRD generation (system refines, does not create from scratch)

## Terminology & Standards

**Critical Protocol: Unknown Term Research**
All AI participants (Claude, ChatGPT, Gemini) MUST follow this protocol when encountering unfamiliar acronyms or technical terms:

1. **Research First**: Use web search to find official specifications/definitions
2. **Verify with Context**: Present findings and confirm interpretation
3. **Document**: Add verified definitions with source links to this section

**Conflict Resolution for Multiple Standards:**
When research yields multiple authoritative sources:
1. **Prioritization Order**:
   - Official specification bodies (W3C, IETF, ISO)
   - Original creators/maintainers (if identifiable via GitHub/official site)
   - Most recent stable release (not draft/experimental)
   - Most widely adopted (measured by GitHub stars, npm downloads, industry adoption)

2. **Present Options to User**: If multiple valid standards exist (e.g., OAuth 1.0 vs 2.0):
   ```
   "Found multiple standards for [TERM]:
   - [Standard A] (version X.Y, released [date], used by [examples])
   - [Standard B] (version Z, released [date], used by [examples])
   
   Which standard should this PRD target? This choice affects [specific requirements]."
   ```

3. **Document Decision**: Once resolved, update Terminology section with:
   - Chosen standard with version number
   - Source URL and release date
   - Rationale for choice (if not obvious)
   - Explicitly note excluded alternatives

**Outdated Specification Handling:**
If research returns deprecated or outdated specs:
- Check specification's official site for latest version
- Search: `"[term] latest specification"` or `"[term] current standard"`
- Flag if PRD references outdated version: "PRD cites [TERM] v1.2 (deprecated 2023). Current is v2.0 - requires migration plan?"

**Defined Terms:**
- **PRD**: Product Requirements Document - specification document defining product features, scope, and technical requirements
- **MCP**: Model Context Protocol (Anthropic specification v1.0) - standard for tool/server integration with Claude (source: https://modelcontextprotocol.io/specification)
- **API**: Application Programming Interface
- **UUID**: Universally Unique Identifier (RFC 4122) - 128-bit identifier format

**Research Requirement:**
When any term appears in the PRD that is not defined above, the reviewing AI must:
- Search for official specification: `web_search: "[term] specification"` or `web_search: "[term] protocol standard"`
- Fetch authoritative sources to verify meaning
- Follow conflict resolution protocol if multiple standards found
- Challenge the PRD if term is undefined or ambiguous
- Require addition of verified definition with source link

## Core Functionality

### PRD Refinement Process
1. User submits initial PRD markdown content
2. System sequentially engages ChatGPT and Gemini as critics
3. Each critic provides substantive critique of the PRD
4. Claude defends and refines the PRD based on critiques (see Claude's Defender Protocol below)
5. Process continues until both critics reach consensus or max rounds exceeded
6. Returns refined PRD with improvement summary

### Claude's Defender Protocol

**Role Definition:**
Claude acts as the PRD author defending their work while incorporating valid improvements. Claude is NOT a neutral mediator - it has ownership of the PRD and must make judgment calls.

**Decision Framework for Incorporating Feedback:**

When receiving critique, Claude MUST:

1. **Categorize Each Piece of Feedback:**
   - **Type A - Valid Gap**: Missing requirement, undefined behavior, logical inconsistency
   - **Type B - Clarity Issue**: Ambiguous language that could lead to misinterpretation
   - **Type C - Stylistic Preference**: Rephrasing without semantic change, formatting preference
   - **Type D - Out of Scope**: Feature request beyond PRD boundaries
   - **Type E - Misunderstanding**: Critic misread existing content

2. **Apply Decision Rules:**
   - **Type A**: ACCEPT - Add missing content with clear traceability
   - **Type B**: ACCEPT - Rewrite for clarity, preserve intent
   - **Type C**: DECLINE (politely) - "This is a stylistic preference. The current phrasing is clear and consistent with the rest of the document."
   - **Type D**: DECLINE with boundary explanation - "This capability is intentionally excluded from v3.0 scope. Added to Phase 3 roadmap."
   - **Type E**: CLARIFY - "This is already addressed in section X. I'll add a cross-reference for discoverability."

3. **Refinement Techniques:**
   - **For ambiguity**: Add concrete examples, specific constraints, or decision trees
   - **For missing requirements**: Create new numbered sections with acceptance criteria
   - **For contradictions**: Reconcile by clarifying precedence or context boundaries
   - **For undefined terms**: Add to Terminology section with source links

4. **Defend When Appropriate:**
   Claude should push back if:
   - Critique is factually incorrect
   - Suggestion would reduce clarity or add unnecessary complexity
   - Feedback conflicts with validated earlier changes
   - Critic is overstepping scope boundaries

   Defense format:
   ```
   "I respectfully disagree because [specific rationale]. 
   The current approach is preferable because [benefits]. 
   However, I've added [small accommodation] to address your underlying concern."
   ```

**Balancing Principles:**
- **Bias toward improvement**: When in doubt, incorporate feedback that increases clarity or reduces implementation risk
- **Protect coherence**: Reject changes that would fragment the PRD's structure or create inconsistencies
- **Cite changes**: Every modification includes rationale traceable to specific critique

**Handling Conflicting Critics:**
If Gemini disputes a change made based on ChatGPT's feedback:
1. Re-evaluate both positions with fresh eyes
2. Identify which position better serves implementability
3. May revert the earlier change if new argument is more compelling
4. Document the reversal: "Reverted change from Round 2 based on Gemini's point about [specific reason]"

**Consensus Failure Escalation:**
If max rounds reached without consensus:
1. System generates **divergence report** identifying unresolved disagreements
2. Report includes:
   - Specific sections where critics disagree
   - Each critic's final position with rationale
   - Claude's assessment of validity for each position
3. User receives report with three options:
   - Accept "best effort" PRD (Claude's final version)
   - Manually resolve conflicts and resubmit
   - Extend max rounds for specific unresolved sections only (targeted re-debate)

### Async Job Management
- Jobs run asynchronously with unique job IDs (UUID v4 format)
- Status checking via `check_gauntlet_status`
- Retrieve full debate transcripts via `get_debate_transcript`
- List all jobs with filtering via `list_gauntlet_jobs`

**Shared Terminology Cache:**
To prevent redundant research across concurrent jobs:
- In-memory cache stores verified term definitions (TTL: 24 hours)
- Cache key: `term_name:spec_version:source_url`
- Concurrent jobs check cache before triggering new searches
- Cache invalidation: manual via `clear_terminology_cache` tool or automatic on TTL expiry
- Cache miss logging for monitoring term diversity

## Technical Architecture

### MCP Tools (API v3.0)

All tools are exposed via MCP protocol v1.0. Version identifier for this API suite: **v3.0**

- `run_prd_gauntlet`: Start refinement process (returns job ID immediately)
- `check_gauntlet_status`: Poll job progress and retrieve results
- `get_debate_transcript`: Retrieve full conversation with specific critic
- `list_gauntlet_jobs`: List running/completed jobs with status filtering
- `gauntlet_health`: Check system and provider status
- `clear_terminology_cache`: Manually invalidate shared terminology cache

**API Versioning:**
- Current API version: **v3.0** (all endpoints)
- Previous version: v2.6 (deprecated, maintained for 6 months)
- Breaking changes require major version bump
- Clients can specify `api_version` parameter to request specific version behavior

### Model Configuration
- **ChatGPT**: gpt-4o (default, configurable via runtime config)
- **Gemini**: gemini-1.5-pro (default, configurable via runtime config)
- **Claude**: claude-sonnet-4-5 (defender/refiner role)

### Runtime Configuration
Optional configuration parameters for `run_prd_gauntlet`:

```typescript
{
  prdContent: string,           // REQUIRED: The PRD markdown to refine
  maxRoundsPerModel: 5,        // Maximum debate rounds per critic
  maxTotalTokens: number,       // Hard cap triggers early stop
  maxEstimatedCost: number,     // Cost limit in USD triggers early stop
  apiTimeoutMs: 600000,         // Per-API-call timeout (10 min default)
  includeTranscripts: false,    // Include full debates in output
  transcriptSummaryOnly: true,  // If true, include condensed summaries instead of full exchanges
  targetedSections: string[],   // OPTIONAL: For targeted re-debate, array of section paths (e.g., ["FR4 > Rate Limiting"])
  models: {
    chatgpt: "gpt-4o",
    gemini: "gemini-1.5-pro"
  },
  webhookUrl: string            // OPTIONAL: URL for user notifications (undefined term stalls, etc.)
}
```

**Webhook Configuration:**
- **Purpose**: Notify user when job requires input (undefined term stalls, conflicts needing resolution)
- **Setup**: User provides HTTPS endpoint URL in `webhookUrl` parameter
- **Payload Format**:
  ```json
  {
    "jobId": "uuid-v4",
    "event": "user_input_required",
    "reason": "undefined_term_stall",
    "details": {
      "term": "A2A",
      "context": "Section FR7 references A2A protocol",
      "researchAttempts": 3,
      "ambiguousResults": ["Agent2Agent", "Application-to-Application"]
    },
    "responseUrl": "https://api.gauntlet.example/jobs/{jobId}/resolve",
    "timeoutAt": "2026-01-20T15:30:00Z"
  }
  ```
- **Security**: Webhook endpoint must use HTTPS, support standard authentication headers
- **Retry Logic**: Failed webhook deliveries retried 3 times with exponential backoff
- **Fallback**: If webhook fails or not configured, job enters `awaiting_user_input` status (pollable via `check_gauntlet_status`)

**Transcript Storage and Lifecycle:**
- **Storage Location**: In-memory only (Node.js process heap)
- **Structure**: Per-job object containing round-by-round exchanges
- **Retention**: 
  - Kept in memory until job completes
  - Available via `get_debate_transcript` for 30 minutes after job completion
  - Automatically garbage collected after 30-minute window
  - Explicit deletion via `delete_job_data` API (for immediate cleanup)
- **Size Management**: If transcript exceeds 10MB, automatically switches to summary-only mode
- **Security**: No disk persistence, no third-party storage, purged on server restart

**Transcript Length Management:**
- Full transcripts can be 10-50KB per model depending on debate length
- Default: `transcriptSummaryOnly: true` returns:
  - Round number and timestamp
  - Key critique points (max 500 chars)
  - Whether consensus reached
  - Changes made (diff summary)
- Estimated storage: 2-5KB per model vs 10-50KB for full transcripts
- Full transcripts available via separate `get_debate_transcript` call
- Transcript retrieval timeout: 30 seconds (prevents long waits for large debates)

### Rate Limiting & Cost Controls
- Per-model request rate limiting
- Token usage tracking across all API calls
- Estimated cost calculation and cap enforcement
- Configurable timeouts prevent runaway costs

### Error Handling & Monitoring

**Logging Levels:**
- **ERROR**: API failures, timeouts, authentication issues
- **WARN**: Rate limit hits, cost approaching cap, retries triggered
- **INFO**: Job state transitions, consensus reached, cache hits/misses
- **DEBUG**: Individual API calls, token counts, research searches

**Alert Thresholds:**
- 3+ consecutive API failures for same provider → alert "Provider [X] unhealthy"
- Cost per job exceeds 2x historical average → alert "Unusual cost spike"
- >50% of jobs failing to reach consensus → alert "Consensus rate degraded"
- Average job time >10 minutes → alert "Performance degradation"

**Retry Logic:**
- API failures: Exponential backoff (1s, 2s, 4s) with max 3 attempts
- Specific handling:
  - 429 (rate limit): Wait for retry-after header, then resume
  - 5xx (server error): Retry with backoff
  - 401/403 (auth): Fail immediately, no retry
  - Timeout: Retry once with extended timeout (+50%)

**Undefined Term Stall Prevention:**
If a critic fails to properly define a term after 3 research attempts:
1. **Escalate to User**: Present the unclear term with context: "The critic has attempted to research '[TERM]' but results are ambiguous. Please provide a definition or confirm if this is custom terminology."
2. **Notification**: 
   - If `webhookUrl` configured: POST webhook with details (see Webhook Configuration section)
   - If no webhook: Job status → `awaiting_user_input`, user polls `check_gauntlet_status`
3. **User Input Options**:
   - Provide explicit definition (added to Terminology section)
   - Mark as "custom terminology - defined in context" (no external source required)
   - Skip term (flag as "intentionally undefined, addressed in future revision")
4. **Fallback**: If user doesn't respond within 5 minutes, job continues with WARNING status noting unresolved terminology
5. **Logging**: All stalled terms logged for pattern analysis (may indicate need for better search strategies)

**Failure Pattern Detection:**
- System tracks last 100 jobs in rolling window
- If >20% fail with same error type within 1 hour → log aggregate report
- Report includes: error type, affected models, common PRD characteristics
- Used for proactive debugging and provider issue detection

## Critic Instructions

### Research Protocol for Critics
**CRITICAL**: Before critiquing any PRD, critics must verify all technical terminology:

1. **Identify unfamiliar terms**: Flag any acronym or technical term not clearly defined
2. **Check Shared Cache**: Query terminology cache before triggering new research
3. **Research independently** (if cache miss): 
   - Use available search tools to find official specifications
   - Search pattern: `"[term] specification"` or `"[term] protocol standard"`
   - Prioritize: Official docs, RFCs, W3C standards, authoritative GitHub repos
4. **Handle Multiple Standards**: Follow conflict resolution protocol (see Terminology & Standards section)
5. **Challenge ambiguity**:
   ```
   "The PRD uses '[TERM]' without definition. I researched and found 
   [TERM] refers to [FULL NAME] (source: [URL]). 
   
   REQUIRED CHANGES:
   - Add [TERM] definition to Terminology section
   - Link to specification version X.Y
   - Clarify compliance requirements
   - Define scope (which features are in/out)"
   ```
6. **If research yields nothing**:
   ```
   "I cannot find a standard definition for '[TERM]'. The PRD must 
   define this explicitly - is it custom terminology or an industry 
   standard? This ambiguity will cause implementation drift."
   ```

### Critique Focus Areas
Each critic challenges the PRD on:

1. **Terminology Verification** (HIGHEST PRIORITY)
   - All acronyms defined with sources
   - Technical terms disambiguated
   - Standards referenced with version numbers
   - Custom vs. standard implementations clearly marked
   - Conflicting standards resolved and documented

2. **Completeness**
   - Missing requirements or edge cases
   - Undefined behavior scenarios
   - Incomplete error handling specifications

3. **Clarity**
   - Ambiguous language
   - Vague acceptance criteria
   - Missing technical details

4. **Feasibility**
   - Technical constraints
   - Performance implications
   - Resource requirements

5. **Consistency**
   - Internal contradictions
   - Conflicting requirements
   - Inconsistent terminology usage

### Consensus Criteria (Measurable)

**Quantitative Thresholds:**
A critic reaches consensus when ALL of the following are true:

1. **Minimum Round Requirement**: At least 2 full critique rounds completed
2. **Zero Blocking Issues**: No unresolved items in the following categories:
   - Undefined technical terms or acronyms
   - Logical contradictions between requirements
   - Missing error handling for identified failure modes
   - Ambiguous acceptance criteria that lack measurable outcomes

3. **Terminology Completeness**: 100% of technical terms either:
   - Defined in Terminology section with source, OR
   - Marked as "custom - defined in context" with inline explanation

4. **Declining Rate**: In the most recent round, critic raised fewer than 3 new issues (indicating convergence)

5. **Explicit Approval**: Critic must state one of these exact phrases:
   - "I have no further concerns with this PRD."
   - "This PRD is ready for implementation."
   - "CONSENSUS_REACHED"

**Automated Validation:**
System programmatically checks:
- Parse critic's final message for approval phrases
- Scan PRD for undefined acronyms using regex + terminology cache cross-reference
- Count new issues raised in final round vs. previous round
- Verify minimum rounds completed

**Edge Case Handling:**
- If critic approval phrase detected but blocking issues remain → reject consensus, continue debate
- If all quantitative thresholds met but no approval phrase → prompt critic: "All concerns appear addressed. Do you approve this PRD?"
- If 5 rounds pass with declining issues but no approval → escalate to divergence report

## Job States & Lifecycle

### Job Status Values
- `idle`: Job queued, not yet started
- `debating_chatgpt`: Currently in ChatGPT critique round
- `debating_gemini`: Currently in Gemini critique round
- `awaiting_user_input`: Paused, waiting for user to clarify undefined term or resolve conflict
- `complete`: All critics reached consensus or max rounds exceeded
- `error`: Job failed due to API error or system issue
- `consensus_failed`: Max rounds reached without consensus (with divergence report)

### Job Lifecycle
1. User calls `run_prd_gauntlet` → receives job ID, job status: `idle`
2. System begins ChatGPT debate → status: `debating_chatgpt`
3. ChatGPT reaches consensus or max rounds → status: `debating_gemini`
4. Gemini reaches consensus or max rounds → status: `complete` or `consensus_failed`
5. User retrieves results via `check_gauntlet_status`

**Lifecycle with User Interaction:**
- If undefined term stall occurs → status: `awaiting_user_input`
- System sends notification with user options (if webhook configured)
- After user responds → status returns to `debating_[model]`
- 5-minute timeout → job continues with WARNING, status: `debating_[model]`

### Error Handling
- API failures: Retry with exponential backoff (max 3 attempts)
- Timeout: Return partial results with error status
- Cost cap exceeded: Stop gracefully, return best effort results
- Token limit exceeded: Stop gracefully, return partial refinement
- Consensus failure: Return divergence report with escalation options

## Output Format

### Successful Completion
```json
{
  "jobId": "uuid-v4",
  "status": "complete",
  "refinedPrd": "# Updated PRD markdown...",
  "summary": {
    "totalRounds": 5,
    "chatgptRounds": 2,
    "geminiRounds": 3,
    "consensusReached": true,
    "totalTokens": 45000,
    "estimatedCost": 0.23,
    "terminologyResearched": ["MCP", "A2A", "UUID"],
    "cacheHits": 1,
    "cacheMisses": 2
  },
  "transcripts": {
    "chatgpt": [...],  // condensed summaries if transcriptSummaryOnly: true
    "gemini": [...]
  }
}
```

### Consensus Failure Response

**Divergence Report Structure:**

```json
{
  "jobId": "uuid-v4",
  "status": "consensus_failed",
  "refinedPrd": "# Best effort PRD...",
  "divergenceReport": {
    "format": "structured_json",
    "reportVersion": "1.0",
    "unresolvedSections": [
      {
        "section": "FR4 > Rate Limiting",
        "sectionLineNumbers": [145, 167],
        "chatgptPosition": {
          "summary": "Requires per-user rate limiting with Redis",
          "rationale": "Multi-tenant scenarios need user-level tracking",
          "confidence": "high"
        },
        "geminiPosition": {
          "summary": "Per-IP limiting sufficient, Redis adds complexity",
          "rationale": "Simpler implementation, adequate for v3.0 scope",
          "confidence": "medium"
        },
        "claudeAssessment": {
          "summary": "Both valid - depends on auth model",
          "recommendation": "Clarify authentication requirements first",
          "blockingSeverity": "high"
        },
        "impactedRequirements": ["FR4", "NFR2"],
        "roundFirstRaised": 3
      }
    ],
    "recommendedAction": "Clarify authentication model before finalizing rate limiting approach",
    "totalUnresolvedIssues": 1,
    "metricsSummary": {
      "roundsCompleted": 10,
      "convergenceRate": 0.8,
      "avgIssuesPerRound": 2.1
    }
  },
  "escalationOptions": {
    "acceptBestEffort": {
      "action": "Use Claude's final version",
      "riskLevel": "medium",
      "rationale": "Unresolved issues may cause implementation delays"
    },
    "manualResolve": {
      "action": "Review divergence report and resubmit with clarifications",
      "estimatedTime": "15-30 minutes",
      "guidedQuestions": [
        "Does this system require user authentication?",
        "If yes, which rate limiting approach (per-user or per-IP) aligns with the auth model?"
      ]
    },
    "targetedRedebate": {
      "action": "Extend rounds for specific sections only",
      "sections": ["FR4 > Rate Limiting"],
      "additionalRounds": 3,
      "estimatedCost": "$0.08",
      "costBreakdown": {
        "calculation": "Section FR4 is ~450 tokens. 3 rounds * 2 models * (450 input + 800 avg response) = 7,500 tokens",
        "chatgptCost": "$0.0375 (7500 tokens * $0.005/1k)",
        "geminiCost": "$0.0263 (7500 tokens * $0.0035/1k)",
        "totalEstimate": "$0.08 (includes 20% buffer for variance)"
      },
      "estimatedTime": "2-3 minutes",
      "completeExample": {
        "description": "To run a targeted re-debate, call run_prd_gauntlet with the following complete configuration:",
        "code": "run_prd_gauntlet({\n  prdContent: `<insert full PRD markdown from divergenceReport.refinedPrd>`,\n  targetedSections: ['FR4 > Rate Limiting'],\n  maxRoundsPerModel: 3,\n  includeTranscripts: true,\n  transcriptSummaryOnly: false,\n  // Optionally update cost cap to account for additional rounds:\n  maxEstimatedCost: 0.50  // Original cap + targeted re-debate cost\n})",
        "notes": [
          "You MUST include the full PRD content from the previous run (available in divergenceReport.refinedPrd)",
          "targetedSections uses the exact section path strings from divergenceReport.unresolvedSections[].section",
          "The system will ONLY re-debate the specified sections, treating others as frozen",
          "All other configuration parameters (models, timeouts, etc.) can be customized as needed"
        ]
      }
    }
  }
}
```

**Targeted Re-Debate Cost Calculation:**
The `estimatedCost` field is calculated using:
1. **Section Size Measurement**: Extract target section from PRD, count tokens (using tiktoken or equivalent)
2. **Round Estimation**: `additionalRounds * modelsInvolved * (sectionTokens + avgResponseTokens)`
3. **Model Pricing**: Apply current rates (ChatGPT: $0.005/1k input, Gemini: $0.0035/1k input)
4. **Buffer**: Add 20% overhead for API response variance and retries
5. **Formula**: `(totalTokens / 1000) * modelRate * 1.2`

**Field Definitions:**
- `confidence`: AI's self-assessed certainty ("low", "medium", "high")
- `blockingSeverity`: Claude's assessment of how critical resolution is ("low", "medium", "high")
- `convergenceRate`: Percentage of raised issues that were resolved (0.0 to 1.0)
- `guidedQuestions`: User-facing prompts to help resolve specific conflicts
- `estimatedCost`: For targeted re-debate, calculated based on section size and model rates (see cost breakdown)

**Serialization Format:** JSON with UTF-8 encoding, pretty-printed with 2-space indentation

### In-Progress Status
```json
{
  "jobId": "uuid-v4",
  "status": "debating_gemini",
  "progress": {
    "currentModel": "gemini",
    "currentRound": 2,
    "chatgptComplete": true,
    "geminiComplete": false
  }
}
```

## Security & Privacy

### API Key Management
- Provider API keys stored in environment variables
- Never logged or exposed in responses
- Rotation supported without code changes

### Data Handling
- PRD content treated as confidential
- No persistent storage of PRD contents beyond job lifecycle (in-memory only, see Transcript Storage section)
- Transcripts stored only if explicitly requested
- Job metadata retained for operational monitoring (30 days max)
- Terminology cache contains only term definitions, not PRD content

### Input Validation
- PRD size limits enforced (max 50KB input)
- Malicious content detection in metadata fields
- Sanitization of user-provided config parameters

## Testing Strategy

### Performance Testing
**Baseline Metrics (from v2.6):**
- Average job completion: 3.2 minutes
- P95 completion time: 4.8 minutes
- Average cost per job: $0.18

**v3.0 Performance Targets (Adjusted):**
- Average completion: <5 minutes (56% tolerance for research overhead, revised from 25%)
- P95 completion time: <7 minutes (revised from 6 minutes)
- Average cost per job: <$0.30 (67% tolerance, revised from 39%)
- **Rationale**: Initial 25% tolerance was optimistic given research protocol adds 1-2 search queries per undefined term. Revised targets account for PRDs with 3-5 undefined terms (typical case).

**Load Testing Scenarios:**
1. **Single Job Baseline**: Run 10 jobs sequentially, measure average time
2. **Concurrent Load**: 5 concurrent jobs, verify no cache contention
3. **Cache Effectiveness**: Run 20 jobs with overlapping terminology, measure cache hit rate (target: >60%)
4. **Research Overhead**: Compare jobs with 0, 3, 5 unknown terms - measure time delta

**Performance Monitoring:**
- Real-time dashboards tracking: job duration, token usage, cost per job
- Alerting when metrics exceed targets by >20%
- Weekly reports comparing v2.6 vs v3.0 performance

### Undefined Term Detection Testing

**Test Cases:**
1. **Known Terms Only**: PRD with 100% defined terminology → critics should skip research, complete faster
2. **Single Unknown Term**: Inject undefined acronym → verify critic triggers search, cites source, requires definition
3. **Multiple Standards**: Use term with 2+ valid specs → verify conflict resolution protocol triggered
4. **Outdated Spec Reference**: Reference deprecated version → verify critic flags and suggests current version
5. **Completely Novel Term**: Invent nonsense acronym → verify critic demands clarification
6. **Cache Hit Validation**: Run 2 jobs with same unknown term → verify second job uses cached definition

**Verification Method:**
- Parse job transcripts programmatically
- Assert: `research_triggered == true` for unknown terms
- Assert: `definition_added_to_prd == true` after resolution
- Assert: `cache_hit == true` for repeated terms
- Measure: time savings from cache hits

**Undefined Term Catch Rate Testing:**
- **Revised Target**: 85% catch rate (down from 95-100%)
- **Rationale**: Accounting for:
  - Domain-specific jargon that may not have public specifications
  - Ambiguous acronyms with multiple valid meanings in context
  - Novel terminology in emerging tech areas
- **Test Methodology**: 
  - Curated test corpus of 100 PRDs with intentionally undefined terms
  - Manual validation: which terms *should* have been caught
  - Calculate: (terms_caught / terms_should_catch) * 100
  - Iterate on search patterns if below 85%

### Consensus Criteria Testing

**Automated Test Suite:**

1. **Quantitative Threshold Validation**:
   ```python
   def test_consensus_thresholds():
       # Mock a job with known state
       job = create_mock_job(
           rounds_completed=2,
           undefined_terms=[],
           contradictions=[],
           new_issues_last_round=1,
           approval_phrase_present=True
       )
       assert system.check_consensus(job) == True
   ```

2. **Edge Case Tests**:
   - Approval phrase present but undefined terms remain → expect consensus=False
   - All thresholds met except approval phrase → expect system prompts critic
   - 5 rounds with declining issues, no approval → expect divergence report

3. **False Positive Prevention**:
   - Inject PRD with subtle contradictions
   - Verify system catches before approving consensus
   - Test with 50 synthetic "flawed but well-formatted" PRDs

4. **Integration Testing**:
   - Run 20 real PRDs through system
   - Manually review final outputs
   - Verify: no undefined terms, no logical gaps
   - If failures found → adjust thresholds or add validation checks

**Test Coverage Targets:**
- 100% of consensus criteria branches covered
- 95% of edge cases handled correctly
- <5% false positive rate (approving flawed PRDs)
- <2% false negative rate (rejecting valid PRDs)

### Backwards Compatibility Testing

**v2.6 API Compatibility:**
- All existing `run_prd_gauntlet` parameters must work unchanged
- New parameters (`transcriptSummaryOnly`, etc.) are optional with safe defaults
- Output format remains compatible (new fields added, none removed)

**Test Matrix:**
```typescript
// v2.6 style call (should work identically)
run_prd_gauntlet({
  prdContent: "...",
  maxRoundsPerModel: 3
})

// v3.0 enhanced call (new features)
run_prd_gauntlet({
  prdContent: "...",
  maxRoundsPerModel: 3,
  transcriptSummaryOnly: true,  // new parameter
  api_version: "3.0"
})
```

**Validation Criteria:**
- v2.6 style calls complete successfully without errors
- Default behavior unchanged (full transcripts if `includeTranscripts: true`)
- Response schema passes v2.6 validation (superset, not breaking change)
- Existing client code requires zero modifications

**Regression Test Suite:**
- Run 50 historical v2.6 PRDs through v3.0 system
- Assert: output structure matches v2.6 format (allowing new optional fields)
- Assert: no new required parameters introduced
- Assert: consensus rates comparable (within 5%)

## Success Metrics

### Quality Indicators
- Consensus reached rate (target: >90%)
- Average rounds to consensus (target: <4 per model)
- User satisfaction with refined PRDs
- Undefined term catch rate (target: 85%)

### Performance Metrics
- Average job completion time (target: <5 minutes, 56% tolerance vs v2.6)
- API error rate (target: <1%)
- Cost per refinement (target: <$0.30, 67% tolerance vs v2.6)
- Cache hit rate for terminology (target: >60% after warm-up period)

### Research Protocol Effectiveness
- Percentage of PRDs with undefined acronyms caught by critics (target: 85%)
- Reduction in implementation failures due to terminology ambiguity (measured via user feedback)
- Time saved by cache vs. redundant research (measured per job)
- Conflict resolution success rate when multiple standards found (target: >90% resolved without escalation)

## Phase 3 Roadmap

### Potential Enhancements
1. **Security Review Mode**: Dedicated security-focused critique pass
2. **Parallel Debate**: Run ChatGPT and Gemini simultaneously
3. **Custom Critic Personas**: User-defined critique focus areas
4. **PRD Versioning**: Track refinement history across multiple gauntlet runs
5. **Automated Standards Lookup**: System proactively searches for unknown terms before presenting to critics

### Research Protocol Automation
Future enhancement: System automatically searches for unknown terms and proposes definitions before critics review:

```typescript
// Before critics see PRD, system:
1. Extract all acronyms/technical terms via regex + NLP
2. Cross-reference with shared terminology cache
3. Auto-search unknown terms using prioritization rules
4. Present proposed definitions to user for approval
5. Update PRD Terminology section
6. Then send to critics for review (reduced research overhead)
```

**Expected Impact:**
- Reduce average job time by 30-60 seconds (pre-search vs. critic-triggered)
- Increase cache utilization to >80%
- Improve user experience (fewer interruptions for term clarification)

### Terminology Database Maintenance Strategy
**Current Approach (v3.0):** In-memory cache with 24-hour TTL, no persistent storage

**Future Consideration (Phase 3):**
- Persistent terminology database (SQLite or PostgreSQL)
- Weekly automated updates from standard bodies (W3C, IETF feeds)
- User contribution system for domain-specific terms
- Versioned entries tracking spec evolution

**Maintenance Requirements:**
- Manual curation: ~2 hours/week for reviewing new standards
- Automated updates: Daily RSS/Atom feed checks
- Community contributions: Reviewed within 48 hours
- Database size estimate: 10-50MB (10,000+ terms with metadata)

## Appendix: Failure Prevention

### Case Study: A2A Protocol Failure
**Incident**: Three AIs (Claude, ChatGPT, Gemini) all misunderstood "A2A" as a custom protocol instead of the official Agent2Agent Protocol, leading to incorrect implementation.

**Root Cause**: No systematic verification of acronyms or technical terms.

**Prevention**: Research protocol (defined in Terminology & Standards section) ensures:
1. Unknown terms trigger immediate research
2. Found specifications are verified with user
3. Definitions are documented with authoritative sources
4. Critics challenge any undefined terminology
5. Conflicts between multiple standards are explicitly resolved

**Expected Outcome with v3.0**: Any of the three AIs would have:
- Searched for "A2A protocol specification"
- Found https://a2a-protocol.org/spec
- If multiple standards found (e.g., Agent2Agent vs. Application-to-Application), triggered conflict resolution
- Verified with user: "A2A is the Agent2Agent Protocol v1.2. Should we implement this official standard?"
- Required PRD update with spec link and compliance requirements
- Added to terminology cache for future jobs

This protocol transforms "three AIs guessing wrong" into "one AI catching it early."

---

**Version**: 3.0.0  
**Last Updated**: 2026-01-21  
**Status**: Ready for Implementation
