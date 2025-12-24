# PRD: PRD Gauntlet MCP Server

**Version:** 2.6.0  
**Status:** Final — Gauntlet Complete (Gemini Fix Validated)  
**Reviewed By:** ChatGPT (v2.3.1→v2.4 ✓), Gemini (v2.4→v2.5→v2.6 ✓)
**Job ID:** 1588b334-5b38-4d43-9003-e4235451540c

---

## Overview

An MCP (Model Context Protocol) server that enables Claude to orchestrate multi-model PRD refinement. When invoked, Claude generates a PRD, then autonomously debates with ChatGPT and Gemini until consensus is reached, returning the battle-tested final document.

## Problem Statement

Creating high-quality PRDs currently requires manual iteration across multiple AI models. The user must context-switch between platforms, copy-paste documents, mentally track feedback, and determine when refinements are sufficient. This process is time-consuming and introduces cognitive overhead that could be automated.

## Target User

Product-minded developers and technical founders who use Claude as their primary AI interface and want multi-model validation without leaving their workflow. Comfortable with MCP server configuration and API credentials.

## Out of Scope

- UI/UX mockup generation
- Market research or competitive analysis
- Code generation from PRD
- Integration with project management tools (Jira, Linear, etc.)
- Real-time collaborative editing

---

## Core Workflow

1. User asks Claude to create a PRD for a feature/product
2. Claude generates v1 PRD
3. User reviews and approves direction
4. User invokes: *"Run this through the gauntlet"*
5. Claude calls `run_prd_gauntlet` tool with current PRD
6. **MCP Server orchestrates:**
   - Claude ↔ ChatGPT debate until consensus
   - Claude ↔ Gemini debate until consensus
7. Final PRD + changelog returned to Claude
8. Claude presents results to user

---

## Functional Requirements

### FR1: MCP Tool — `run_prd_gauntlet`

**Input:**
```typescript
{
  prd: string;                    // The PRD markdown content
  metadata?: {
    title?: string;               // PRD title for context
    productContext?: string;      // Background info for critics
    constraints?: string[];       // Known constraints to respect
  };
  config?: {
    maxRoundsPerModel?: number;   // Default: 5
    maxTotalTokens?: number;      // Hard cap on CUMULATIVE input+output tokens across all API calls
    maxEstimatedCost?: number;    // USD cap, early stop if exceeded
    apiTimeoutMs?: number;        // Per-API-call timeout in ms. Default: 600000 (10 min)
    includeTranscripts?: boolean; // Default: false
    forceUnlockReverts?: boolean; // Default: false. Override revert locks in exceptional cases.
    models?: {
      claude?: string;            // Default: version of Claude that invoked the tool
      chatgpt?: string;           // Default: "gpt-4o"
      gemini?: string;            // Default: "gemini-1.5-pro"
    }
  }
}
```

**Handling oversized PRDs:**
- If initial PRD exceeds 80% of the Claude model's context window, return error: `PRD_TOO_LARGE` with message: "PRD exceeds recommended input size. PRD token count: [X], Maximum allowed: [Y]. Consider breaking into smaller documents or using a model with larger context window."
- Token counts reported are estimates based on Claude's tokenizer
- No automatic chunking or summarization in MVP
- Context window enforcement uses conservative limits (e.g., Claude 3.5 Sonnet = 160K tokens input limit, enforce at 128K)

**Output:**
```typescript
{
  jobId: string;                  // UUIDv4, generated server-side
  finalPrd: string;               // Refined PRD markdown
  changelog: ChangeEntry[];
  debates?: {                     // Omitted if all critics skipped
    chatgpt?: DebateSummary | DebateTranscript;
    gemini?: DebateSummary | DebateTranscript;
  };
  stats: {
    totalRounds: number;
    tokensUsed: {
      claude: number;
      chatgpt: number;
      gemini: number;
    };
    estimatedCost: number;
    stoppedEarly?: {
      reason: "cost_cap" | "token_cap" | "timeout";
      atModel?: "chatgpt" | "gemini";  // Which critic was active when stop occurred
      unresolvedConcerns: string[];
    };
    skippedCritics?: Array<{
      model: "chatgpt" | "gemini";
      reason: string;
    }>;
  }
}

interface DebateSummary {
  rounds: number;
  outcome: "consensus" | "max_rounds" | "early_stop";
  keyChanges: string[];
  unresolvedConcerns?: string[];
}

interface DebateTranscript {
  summary: DebateSummary;
  messages: Array<{
    role: "defender" | "critic";
    content: string;
    timestamp: string;
  }>;
}
```

**Error Response:**
```typescript
{
  error: "INVALID_INPUT" | "PROVIDER_ERROR" | "CONFIG_ERROR" | "PRD_TOO_LARGE" | "RATE_LIMIT_EXCEEDED";
  message: string;
  details?: Record<string, unknown>;
}
```

**Acceptance Criteria:**
- Returns `finalPrd` even on early stop or max rounds
- `changelog.length >= 1` if any modifications occurred
- `stats.totalRounds` equals sum of rounds across all critics
- If all critics skipped, `debates` field is omitted (not empty object)
- `maxTotalTokens` enforced as cumulative sum of (input + output) tokens across all API calls

---

### FR2: MCP Tool — `check_gauntlet_status`

For long-running gauntlets, allows Claude to poll progress.

**Input:**
```typescript
{
  jobId: string;
}
```

**Output:**
```typescript
{
  jobId: string;
  status: "idle" | "debating_chatgpt" | "debating_gemini" | "complete" | "error";
  currentRound?: number;
  currentModel?: "chatgpt" | "gemini";
  lastUpdate?: string;
  partialResult?: {
    currentPrd: string;
    changelogSoFar: ChangeEntry[];
  }
}
```

**Error Response:**
```typescript
{
  error: "JOB_NOT_FOUND";
  message: "Job ID not found. Jobs are ephemeral and lost on server restart.";
}
```

**Acceptance Criteria:**
- Returns `JOB_NOT_FOUND` error if job ID doesn't exist or server restarted
- Never returns `partialResult` when `status` is `"complete"`
- `currentRound` and `currentModel` only present when status is `debating_*`

---

### FR3: MCP Tool — `get_debate_transcript`

Retrieve full transcript for a specific debate (when `includeTranscripts` was false).

**Input:**
```typescript
{
  jobId: string;
  model: "chatgpt" | "gemini";
}
```

**Output:**
```typescript
{
  transcript: DebateTranscript;
}
```

**Error Responses:**
```typescript
{ error: "JOB_NOT_FOUND"; message: "..." }
{ error: "TRANSCRIPT_UNAVAILABLE"; message: "Transcript not stored or server restarted." }
{ error: "CRITIC_SKIPPED"; message: "This critic was skipped due to unavailability." }
```

**Acceptance Criteria:**
- Returns `TRANSCRIPT_UNAVAILABLE` if transcripts weren't stored or server restarted
- Returns `CRITIC_SKIPPED` if the requested critic was skipped due to fallback policy
- Returns full transcript with all messages if available

---

### FR4: Debate Engine

**Definition of a "round":** A round is one critic → defender exchange (critic sends feedback, defender responds). Malformed JSON responses still consume a round.

**Round limits:** `maxRoundsPerModel` applies independently per critic debate. There is no overall max rounds cap; total rounds = sum of rounds across all critics.

**Changelog-aware critique:**
Each critic receives:
1. Current PRD text
2. Changelog summary showing all modifications made in previous critic debates
3. Source attribution for each change (which critic requested it)

This prevents re-suggesting changes already implemented by earlier critics. Critics are instructed to review the changelog first and only suggest new improvements or dispute existing changes if they have strong rationale.

**Engine behavior:**
- Send PRD + defender prompt to Claude API
- Send PRD + changelog summary + critic prompt to ChatGPT/Gemini API
- Claude receives critique, generates revision or rebuttal
- Detect consensus via exact phrase match or structured approval
- Exit loop on consensus OR max iterations OR cost/token cap
- If max iterations hit without consensus, flag unresolved concerns

---

### FR5: Consensus Detection

Consensus is reached **only** when:

1. Critic returns the **exact approval phrase**: `"No further concerns. PRD approved."`, OR
2. Critic returns a **structured approval object**:
```typescript
{
  approved: true,
  remainingConcerns: []
}
```

**Handling conditional approvals:**
If critic responds with conditional approval (e.g., "Approved if X is added"):
- Extract the condition
- Claude must address the condition in next round
- Loop continues until unconditional approval or max rounds

**Handling malformed JSON:**
- If JSON parse fails → treat as non-approval, continue loop
- If JSON parses but schema invalid (e.g., missing `approved` field, `remainingConcerns` not empty) → Claude responds asking critic to restate approval in valid schema; counts as one round
- After 2 consecutive malformed responses from same critic → log warning, continue as non-approval
- **Escalation:** After 3 consecutive malformed responses → exit debate loop with outcome `"parsing_failure"`, log error, flag unresolved concerns

**Fuzzy substring matching is explicitly NOT used in consensus detection.** However, if a critic uses near-match phrasing (detected via Levenshtein distance < 5 from approval phrase), the server logs a warning suggesting the critic use exact phrasing, but does not treat it as approval.

---

### FR6: Conflict Resolution

Critics are engaged sequentially (ChatGPT → Gemini). Later critics may dispute changes made for earlier critics.

**Rules:**
- Source of truth is always the **latest Claude-revised PRD**
- Each critic sees the current PRD + changelog summary (showing all previous changes with source attribution)
- If Gemini objects to a change ChatGPT requested:
  - Claude evaluates both positions
  - Claude may revert the earlier change if Gemini's argument is stronger
  - Reversals are logged as new `ChangeEntry` items with `type: "revert"`
- Claude must justify reversals in the changelog

**Re-evaluation triggers (clarified with example):**

*Example scenario:*
1. Round 1 (ChatGPT): Suggests adding "FR12: Audit Logging"
2. Claude accepts, adds FR12
3. Round 2 (Gemini): Objects to FR12, argues it's out of scope
4. Claude agrees, reverts FR12 (logged as revert of change #5)
5. **Lock applied:** FR12 cannot be re-added or re-reverted by ChatGPT in subsequent rounds of the same gauntlet
6. If ChatGPT suggests a *different* logging requirement (e.g., "FR12: Error Logging"), it's treated as a new change (not locked)

**Lock semantics:**
- Locks apply to the specific section path + change type
- Locked: "FR12 > Audit Logging" as addition
- Not locked: "FR12 > Error Logging" (different content)
- Lock prevents infinite ping-pong between critics
- If both critics repeatedly contest the same section (3+ rounds each), flag as `highConflictSection` in stats with summary of positions

**Force unlock mechanism:**
- When `config.forceUnlockReverts = true`, revert locks are ignored
- All changes can be re-reverted regardless of prior lock state
- Use case: User manually reviews conflict and wants to allow the debate to reconsider a locked change
- Default is `false` to maintain intended automatic behavior
- When enabled, log warning: "Force unlock enabled - revert locks disabled for this gauntlet run"

**Jitter for conflict avoidance:**
If a section has been modified ≥2 times across critics, Claude's defender prompt includes a random prioritization signal ("Prioritize clarity over completeness" or vice versa, rotated) to break deterministic loops.

**Phase 3 Parallel Merge Policy (provisional):**
If parallel debates are implemented, Claude merges by:
1. Applying higher-severity issues first (blockers > gaps > clarifications)
2. Resolving conflicts using FR6 rules (Claude adjudicates, logs reversals)
3. Running a final reconciliation round if conflicts detected

---

### FR7: Revision Tracking

```typescript
interface ChangeEntry {
  version: number;
  source: "chatgpt" | "gemini";
  round: number;
  type: "addition" | "modification" | "deletion" | "revert";
  summary: string;
  section?: string;           // PRD header path, e.g., "FR4 > Consensus Detection"
  diff?: string;              // Line-based diff showing exact changes
  revertedChange?: number;    // If type=revert, which version was reverted
}
```

**Defender output contract (clarified):**

Claude's defender response includes:
1. **Full updated PRD text** (used as source of truth for next round)
2. **Round delta** in simplified JSON format:
```typescript
{
  type: "addition" | "modification" | "deletion" | "revert";
  summary: string;
  section?: string;
}
```

The server:
- Parses Claude's full PRD text for the next round's input
- Enriches the delta JSON into a full `ChangeEntry` by adding `version`, `source`, `round`, and `revertedChange`
- Generates line-based diff by comparing previous PRD version with Claude's updated version (using `diff` library or equivalent)
- Stores both PRD and changelog entry with diff

**Diff generation:**
- Uses unified diff format (similar to `git diff`)
- Only includes ±3 lines of context around changes
- If diff exceeds 500 lines, truncate with "... [diff truncated, full PRD available] ..."
- Diff field is optional; if diff generation fails (e.g., PRD is not valid markdown), log warning and omit field

**Section Path Reliability (MVP):**
The `section` field is **best-effort**. LLMs may inconsistently format header paths (e.g., "FR4" vs "Functional Requirements > Consensus"). For MVP, accept Claude's output as-is. Phase 2 enhancement: server-side fuzzy matching to normalize section paths against actual PRD markdown structure.

---

### FR8: Configuration

**Environment variables:**
```
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
GOOGLE_AI_API_KEY=
```

**Optional config file (`gauntlet.config.json`):**
```json
{
  "maxRoundsPerModel": 5,
  "maxTotalTokens": 100000,
  "maxEstimatedCost": 1.00,
  "includeTranscripts": false,
  "forceUnlockReverts": false,
  "models": {
    "claude": "claude-sonnet-4-5-20250929",
    "chatgpt": "gpt-4o",
    "gemini": "gemini-1.5-pro"
  },
  "prompts": {
    "defender": "prompts/defender.md",
    "critic": "prompts/critic/chatgpt.md"
  },
  "fallbackPolicy": {
    "onModelUnavailable": "skip",
    "onInvalidModelId": "error"
  },
  "costRates": {
    "claude": { "input": 3.00, "output": 15.00 },
    "chatgpt": { "input": 2.50, "output": 10.00 },
    "gemini": { "input": 1.25, "output": 5.00 }
  },
  "rateLimiting": {
    "requestsPerMinute": 10,
    "burstSize": 3
  }
}
```

**Prompt loading security:**
- Prompt files MUST be located within the `prompts/` directory (relative to server root)
- Subdirectories within `prompts/` are allowed for organization (e.g., `prompts/critic/chatgpt.md`, `prompts/defender/v2.md`)
- Path traversal attempts (e.g., `../../etc/passwd`, `prompts/../config.json`) are rejected with error: `INVALID_PROMPT_PATH`
- All paths are normalized and validated to ensure they resolve within `prompts/`
- Maximum prompt file size: 50KB per file
- Prompts are validated as UTF-8 text before loading
- Alternative: Base64-encoded prompts in config (Phase 2 enhancement)

**All configuration values are adjustable via:**
1. Config file (persistent defaults)
2. Per-invocation overrides in `run_prd_gauntlet` tool call
3. Environment variables (for API keys only)

**Documentation requirements:** README must include a "Configuration Guide" section with:
- Example scenarios for different use cases (quick validation vs deep review)
- Recommended cap values for different budget tiers
- How to adjust limits mid-project

---

### FR9: Model Validation & Fallback

On server startup and before each gauntlet run:
- Validate model IDs by pinging each provider
- If model ID is invalid: error immediately with clear message
- If provider is unavailable (timeout/5xx):
  - `fallbackPolicy.onModelUnavailable = "skip"`: Skip that critic, log reason, continue
  - `fallbackPolicy.onModelUnavailable = "error"`: Fail the gauntlet

---

### FR10: Cost Estimation

Cost is estimated as follows:
- **Tokens counted:** Both prompt (input) and completion (output) tokens per API call
- **Rates source:** Hardcoded defaults in codebase reflecting provider pricing at release; overridable via `costRates` in config file. Server does not query live pricing APIs.
- **Calculation:** `(inputTokens / 1M * inputRate) + (outputTokens / 1M * outputRate)`
- **Safety margin:** 10% buffer added to all cost estimates to account for tokenization variations
- **Rounding:** Rounded to nearest cent (USD) for display; full precision used for cap enforcement
- **Scope:** Cumulative across all API calls (Claude + ChatGPT + Gemini)
- **Maintenance responsibility:** Product owner reviews and updates hardcoded rates with each minor version release (at least quarterly). If no rate changes, release notes state "Cost rates unchanged." GitHub issue template provided for community-reported rate discrepancies.
- **User notification:** If estimated cost (with buffer) exceeds 80% of `maxEstimatedCost` cap, log warning visible to user via Claude's response

---

### FR11: Job Lifecycle (MVP)

**MVP Behavior:**
- Jobs are **ephemeral and in-memory only**
- Job state is lost on server restart
- No persistence layer in Phase 1

**Implications:**
- `check_gauntlet_status` and `get_debate_transcript` only work while server process is alive
- After restart, these tools return typed errors (`JOB_NOT_FOUND`, `TRANSCRIPT_UNAVAILABLE`)
- Claude should inform user that job history is not preserved

**Interrupted Process Recovery:**
If gauntlet is interrupted mid-run due to server restart or crash:
- User is advised to re-run with same PRD
- Claude includes note: "The previous gauntlet was interrupted. Starting fresh with your PRD."
- No automatic resume capability in MVP

**Phase 2:** Optional durable storage (Redis/SQLite) with restart recovery and configurable TTL.

---

### FR12: Rate Limiting

**Server-level rate limiting:**
- Configurable via `rateLimiting.requestsPerMinute` and `rateLimiting.burstSize`
- Default: 10 requests/minute, burst of 3
- Applies per API key (future: per user/org if auth layer added)
- Exceeding limit returns `RATE_LIMIT_EXCEEDED` error with `Retry-After` header
- Rate limit state is in-memory (resets on server restart)

**Provider-level rate limiting:**
- MCP server respects `Retry-After` headers from provider APIs
- Exponential backoff with jitter for 429 responses (max 3 retries)
- If provider rate limit exceeded, return partial results + error details

---

## Non-Functional Requirements

### NFR1: Transparency
- Debate summaries always returned
- Full transcripts available on request via `get_debate_transcript`
- User can ask Claude to explain any change in the changelog
- **Optional progress notifications:** When `check_gauntlet_status` is polled, include `intermediateInsights` field with high-level summary of debate themes so far

### NFR2: Timeout Handling
- Individual API calls timeout configurable via `apiTimeoutMs` (default: 600000ms / 10 minutes)
- Total gauntlet timeout at 30 minutes (hard cap)
- Queued requests timeout after 15 minutes; if not started by then, return `QUEUE_TIMEOUT` error with message: "Your request timed out after 15 minutes in the queue. The server is overloaded. Please try again later."
- Graceful degradation: return best PRD so far + partial results + unresolved concerns

### NFR3: Cost Efficiency
- Token count tracked per model per round
- Estimated cost calculated per FR10 (with 10% safety margin)
- Hard caps enforced: `maxTotalTokens`, `maxEstimatedCost`
- Early stop returns `stoppedEarly` with reason and unresolved concerns

### NFR4: Security & Privacy

**Default behavior:**
- No PRD content is logged or persisted
- Only metadata logged (job ID, timestamps, token counts, outcomes)

**Opt-in persistence (`persistHistory: true`):**
- Storage location must be specified in config
- Redaction rules applied before storage
- Encryption at rest recommended (user responsibility)

**Pre-flight sensitive data scan:**
When `persistHistory: true`, server runs regex scan on PRD for common secret patterns before first API call. If matches found:
- Log warning with match count (not matched content)
- Prompt user via Claude: "Potential sensitive data detected. Continue? (y/n)"
- If user declines, abort gauntlet with `USER_ABORTED` status

**Redaction patterns (applied automatically):**
- Environment variable patterns: `ANTHROPIC_API_KEY=...`, `OPENAI_API_KEY=...`, `GOOGLE_AI_API_KEY=...`
- Bearer tokens: `/[Bb]earer\s+[A-Za-z0-9\-_]+/`
- API key patterns: `/api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9\-_]+/i`
- OpenAI-style keys: `/sk-[A-Za-z0-9]{20,}/`
- Generic secrets: `/secret["']?\s*[:=]\s*["']?[A-Za-z0-9\-_]+/i`

**Redaction scope:** Redaction runs only on persisted transcripts/PRDs when `persistHistory=true`. The `finalPrd` returned to Claude is never redacted — users see their original content.

**Strengthened disclaimer:** 

**⚠️ CRITICAL SECURITY NOTICE:**
- Regex-based redaction is NOT foolproof and should NOT be relied upon for protecting sensitive data
- **DO NOT include production API keys, database credentials, PII, PHI, or other regulated data in PRDs**
- Users are **solely responsible** for ensuring no sensitive information is included in PRD content
- The pre-flight scan is a convenience feature, not a security guarantee
- If in doubt, run gauntlets without `persistHistory` enabled

**Legal considerations:**
- Server does not retain data beyond session unless `persistHistory=true`
- Users are responsible for compliance with data protection regulations (GDPR, CCPA, etc.)
- README must include "Data Handling Policy" section with explicit guidance:
  - Do not include PII, PHI, or regulated data in PRDs
  - If persistence is enabled, ensure storage location complies with organizational policies
  - API providers (Anthropic, OpenAI, Google) have their own data retention policies; consult their terms

### NFR5: Scalability & Performance

**Load handling:**
- MVP supports single concurrent gauntlet per server instance
- If second request arrives while gauntlet is running, queue it (max queue size: 3)
- Queued requests timeout after 15 minutes; return `QUEUE_TIMEOUT` if not started
- If queue is full, return error: `SERVER_BUSY` with estimated wait time
- Log warning if average gauntlet duration > 5 minutes (suggests need for optimization)

**Phase 2 enhancements:**
- Multi-instance horizontal scaling with shared job queue (Redis)
- Load balancing based on estimated token consumption
- Priority queue for different user tiers

---

### NFR6: Logging

**Structured logging (JSON format) with these event types:**

| Event Type | Fields | Example |
|------------|--------|---------|
| `job.started` | `jobId`, `timestamp`, `prdTitle`, `modelsConfig` | Job initiated with ChatGPT + Gemini |
| `job.completed` | `jobId`, `timestamp`, `totalRounds`, `outcome`, `estimatedCost` | Job finished with consensus |
| `job.failed` | `jobId`, `timestamp`, `error`, `errorDetails` | Job failed due to provider timeout |
| `api.call` | `jobId`, `provider`, `model`, `inputTokens`, `outputTokens`, `latencyMs` | Called gpt-4o, 1200 tokens in, 450 out |
| `consensus.reached` | `jobId`, `critic`, `round` | ChatGPT approved PRD at round 3 |
| `consensus.failed` | `jobId`, `critic`, `reason`, `unresolvedConcerns` | Gemini max rounds exceeded |
| `config.loaded` | `timestamp`, `source`, `overrides` | Config loaded from gauntlet.config.json |
| `rate_limit.exceeded` | `timestamp`, `apiKey`, `limitType` | Server rate limit hit |
| `warning.parsing_failure` | `jobId`, `critic`, `round`, `attemptCount` | Gemini returned malformed JSON |
| `warning.cost_threshold` | `jobId`, `currentCost`, `capCost` | 80% of cost cap reached |

**Log retention:** 
- Logs rotate daily at **00:00 UTC**
- Retained for 30 days by default (configurable via `logging.retentionDays` in config)
- Rotation time configurable via `logging.rotationTime` (default: "00:00 UTC")

**Privacy:** PRD content is NEVER logged unless explicitly enabled via debug flag (not recommended in production).

---

## Failure Mode User Messaging

Claude should summarize failures to the user as follows:

| Scenario | Claude's Message |
|----------|------------------|
| Critic skipped (unavailable) | "Gemini was unavailable during this run; the PRD was reviewed by ChatGPT only." |
| Early stop (cost cap) | "The gauntlet stopped early due to cost limits. Here's the PRD so far, with these unresolved concerns: [list]. You may want to address these manually." |
| Early stop (token cap) | "The gauntlet stopped early due to token limits. [same as above]" |
| Max rounds (no consensus) | "ChatGPT and I couldn't reach full consensus after 5 rounds. Here's the final PRD with these outstanding concerns: [list]." |
| Parsing failure escalation | "I encountered repeated parsing errors from [model]. Here's the PRD with partial feedback applied. Remaining concerns: [list]." |
| Job not found | "I couldn't find that gauntlet run — job history isn't preserved after server restarts." |
| Both critics skipped | "Neither ChatGPT nor Gemini were available. Here's the original PRD unchanged. Try again later or review manually." |
| Server busy | "The gauntlet server is currently processing another request. Please try again in a moment." |
| Interrupted gauntlet | "The previous gauntlet was interrupted. Starting fresh with your PRD." |
| PRD too large | "Your PRD exceeds the recommended input size. PRD token count: [X], Maximum allowed: [Y]. Consider breaking it into smaller documents or using a model with a larger context window." |
| Rate limit exceeded | "Rate limit exceeded. Please wait [X] seconds before trying again." |
| Queue timeout | "Your request timed out after 15 minutes in the queue. The server is overloaded. Please try again later." |

---

## Technical Architecture

```
┌─────────────────────────────────────────────────────┐
│                   Claude.ai / Claude Code           │
│                                                     │
│   User: "Run this through the gauntlet"             │
│                        │                            │
│                        ▼                            │
│              ┌─────────────────┐                    │
│              │  MCP Tool Call  │                    │
│              │ run_prd_gauntlet│                    │
│              └────────┬────────┘                    │
└───────────────────────┼─────────────────────────────┘
                        │
          ┌─────────────▼─────────────┐
          │    PRD Gauntlet Server    │
          │        (Node.js)          │
          │                           │
          │  ┌─────────────────────┐  │
          │  │   Debate Engine     │  │
          │  │                     │  │
          │  │  ┌───┐ ┌───┐ ┌───┐ │  │
          │  │  │ C │↔│GPT│ │GEM│ │  │
          │  │  └───┘ └─┬─┘ └─┬─┘ │  │
          │  │          │     │   │  │
          │  └──────────┼─────┼───┘  │
          └─────────────┼─────┼──────┘
                        │     │
              ┌─────────▼─┐ ┌─▼─────────┐
              │  OpenAI   │ │  Google   │
              │    API    │ │    API    │
              └───────────┘ └───────────┘
```

## Project Structure

```
prd-gauntlet-mcp/
├── src/
│   ├── index.ts              # MCP server entry
│   ├── server.ts             # MCP server setup & tool registration
│   ├── tools/
│   │   ├── runGauntlet.ts    # Main tool implementation
│   │   ├── checkStatus.ts    # Status polling tool
│   │   └── getTranscript.ts  # Transcript retrieval tool
│   ├── debate/
│   │   ├── engine.ts         # Orchestrates debate loops
│   │   ├── defender.ts       # Claude's defense logic
│   │   ├── consensus.ts      # Detects agreement (exact match + structured)
│   │   └── conflict.ts       # Handles cross-critic conflicts
│   ├── clients/
│   │   ├── claude.ts         # Anthropic SDK wrapper
│   │   ├── openai.ts         # OpenAI SDK wrapper
│   │   ├── gemini.ts         # Google AI SDK wrapper
│   │   └── validator.ts      # Model ID validation + health checks
│   ├── prompts/
│   │   ├── defender.md       # System prompt for Claude
│   │   └── critic/
│   │       ├── chatgpt.md    # Critic prompt for ChatGPT
│   │       └── gemini.md     # Critic prompt for Gemini
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   └── utils/
│       ├── changelog.ts      # Tracks revisions
│       ├── cost.ts           # Cost estimation per FR10
│       ├── logger.ts         # Structured JSON logging per NFR6
│       ├── tokens.ts         # Token counting
│       ├── diff.ts           # Diff generation for ChangeEntry
│       ├── redaction.ts      # Secret redaction + pre-flight scan per NFR4
│       └── rateLimiter.ts    # Rate limiting per FR12
├── .env.example
├── gauntlet.config.example.json
├── package.json
├── tsconfig.json
└── README.md
```

---

## Debate Protocol

### Claude Defender System Prompt

```
You are defending a PRD you authored. You will receive critique from another AI model, along with a changelog showing all previous modifications.

**Review Process:**
1. First, review the changelog to see what changes have already been made by other critics
2. Consider whether the new critique is redundant with existing changes
3. Evaluate each piece of feedback:
   - If valid and improves the PRD → incorporate it
   - If already addressed in changelog → acknowledge and cite the existing change
   - If based on misunderstanding → clarify and hold your ground
   - If stylistic preference without compelling rationale → acknowledge but decline
   - If out of scope for this PRD → explain why and decline
   - If the critic's response is malformed or contains invalid JSON → politely ask them to restate clearly

**Decision Criteria for Accepting Feedback:**

*Valid improvements* include:
- Filling gaps in requirements (missing acceptance criteria, undefined behavior)
- Fixing logical inconsistencies or contradictions
- Adding necessary constraints or edge case handling
- Clarifying ambiguous language that could lead to misinterpretation
- Improving testability or measurability of requirements

*Stylistic preferences* include:
- Rephrasing for tone (e.g., "should" vs "must") without changing meaning
- Reorganizing sections without adding/removing content
- Personal formatting preferences (bullet points vs numbered lists)

When in doubt, err on the side of accepting feedback if it increases clarity or reduces implementation risk.

**Conflict Resolution:**
- If a critic disputes a change made by a previous critic, carefully evaluate both positions
- You may revert an earlier change if the new argument is more compelling
- Document your reasoning for the revert in the changelog

**Output Format:**
After addressing feedback, respond in this EXACT format:

---BEGIN RESPONSE---
## Updated PRD
[Full updated PRD here - this is the source of truth for the next round]

## Changes This Round
```json
{
  "type": "addition|modification|deletion|revert",
  "summary": "Brief description of change",
  "section": "PRD header path, e.g., FR4 > Consensus Detection"
}
```

## Full Changelog
[All previous changes included]

## Question for Critic
Do you have any remaining concerns with this PRD?
---END RESPONSE---

If you receive malformed input from the critic, use this format instead:
---BEGIN RESPONSE---
## Changes This Round
```json
{
  "type": "modification",
  "summary": "No changes - requested clarification from critic",
  "section": "N/A"
}
```

## Question for Critic
I couldn't parse your previous response. Could you please restate your feedback or approval in a clear format?
---END RESPONSE---

When the critic confirms unconditional approval, respond exactly with:
CONSENSUS_REACHED
```

### Critic System Prompt

```
You are a senior technical product manager reviewing a PRD. Your job is to find gaps and weaknesses.

{{#if metadata.productContext}}
## Product Context
{{metadata.productContext}}
{{/if}}

{{#if metadata.constraints}}
## Known Constraints
{{#each metadata.constraints}}
- {{this}}
{{/each}}
{{/if}}

{{#if changelog}}
## Previous Changes (from earlier critics)
Review this changelog before providing feedback. Do not re-suggest changes that have already been implemented.
{{changelog}}
{{/if}}

Evaluate:
- Clarity: Are requirements specific and unambiguous?
- Completeness: Are edge cases addressed? Missing requirements?
- Feasibility: Is scope realistic? Technical constraints considered?
- Testability: Can each requirement be verified?

Be specific and actionable. Do not nitpick style. Respect the known constraints listed above.

When ALL substantive concerns have been addressed, respond with EXACTLY ONE of:

Option A (plain text):
"No further concerns. PRD approved."

Option B (structured):
```json
{
  "approved": true,
  "remainingConcerns": []
}
```

If you have conditional approval, state the condition clearly and do NOT use the approval phrases above until the condition is met.
```

---

## Success Metrics

### Primary Metrics
- **Time efficiency:** Automated portion completes in < 5 minutes
- **Quality improvement:** 50% reduction in clarifying questions from Claude Code during implementation
- **User satisfaction:** Post-gauntlet confidence score (1-5 scale)

### Objective Quality Checks (Phase 2+)
- **Requirements coverage score:** Count of FR/NFR/edge case sections vs baseline rubric
- **Ambiguity lint:** Heuristic detection of weak language ("should", "could", "maybe", "might", "probably", "as needed")
- **Testability score:** Percentage of requirements with verifiable acceptance criteria

---

## Open Questions

1. **Parallel vs Sequential:** Should ChatGPT and Gemini debate in parallel? Sequential is simpler but parallel is faster. (See FR6 for provisional merge policy.)
2. **Mid-debate intervention:** Should user be able to inject guidance mid-gauntlet via another tool?
3. **Model weighting:** If models fundamentally disagree after max rounds, should one have tie-breaker authority?
4. **Persistence:** Should debate history be stored for future reference? (Deferred to Phase 2)
5. **BrewAgent integration:** Should this become a BrewAgent capability for feature PRDs?

---

## MVP Scope

### Phase 1 (MVP)
- MCP server with `run_prd_gauntlet` tool
- Sequential debate (ChatGPT → Gemini)
- Exact-match consensus detection
- Malformed JSON handling (parse fail = non-approval)
- Structured defender output with round delta JSON
- Changelog generation with server enrichment
- Markdown output
- Cost/token tracking with hard caps (FR10)
- Model validation on startup
- Typed error responses for job lifecycle
- No persistence (ephemeral jobs, documented clearly)
- Basic rate limiting (FR12)
- Structured logging (NFR6)

### Phase 2
- `check_gauntlet_status` for async monitoring
- `get_debate_transcript` tool
- Structured JSON consensus detection
- Custom prompt configuration
- Durable job storage (Redis/SQLite) with restart recovery
- Ambiguity lint scoring
- Detailed cost reporting
- Section path fuzzy matching (normalize Claude's section outputs against actual markdown structure)
- Diff-patch defender output: Claude outputs only changes to apply, server maintains master document (reduces output tokens significantly for large PRDs)
- Pre-flight sensitive data scan

### Phase 3
- Parallel debates with merge policy (FR6)
- Critic severity tagging: Update critic prompt to prefix concerns with `[BLOCKER]`, `[GAP]`, `[CLARIFICATION]` for merge prioritization
- Additional model support via adapter interface
- Persistent history with redaction
- Web UI for debate visualization
- Requirements coverage rubric

---

## Appendix: Changelog

### v2.3.1 → v2.6.0 (Gauntlet Run - Gemini Fix Validated)

| Change | Source | Rationale |
|--------|--------|-----------|
| Added `config.models.claude` option | Gemini | Consistency - allow explicit Claude model configuration |
| Clarified `maxTotalTokens` as cumulative input+output | Gemini | Ambiguity in original spec |
| Added `PRD_TOO_LARGE` error with token counts | Gemini | Fail fast for oversized PRDs |
| Added changelog-aware critique to FR4 | Gemini | Prevent re-suggesting already-implemented changes |
| Clarified revert lock semantics with example | Gemini | Complex logic needed concrete scenario |
| Added `forceUnlockReverts` config option | Gemini | Escape hatch for stuck conflicts |
| Added jitter for conflict avoidance | Gemini | Break deterministic loops |
| Clarified defender outputs full PRD + delta | Gemini | Avoid server-side reconstruction issues |
| Added diff generation to ChangeEntry | Gemini | Transparency on exact changes |
| Added prompt subdirectory support | Gemini | Organization for multiple prompts |
| Added prompt path traversal protection | Gemini | Security hardening |
| Added 10% safety margin to cost estimates | Gemini | Account for tokenization variations |
| Assigned cost rate maintenance responsibility | Gemini | Operational clarity |
| Added 80% cost cap warning | Gemini | User awareness before hitting limit |
| Added pre-flight sensitive data scan | Gemini | Defense in depth for NFR4 |
| Strengthened security disclaimer | Gemini | Legal/compliance clarity |
| Added queue timeout (15 min) | Gemini | Prevent indefinite blocking |
| Added FR12: Rate Limiting | Gemini | Missing requirement for abuse protection |
| Added NFR6: Logging specification | Gemini | Missing requirement for observability |
| Added log rotation time (00:00 UTC) | Gemini | Consistent behavior |
| Expanded defender prompt with decision criteria | Gemini | Clearer guidance for Claude |
| Added critic system prompt to PRD | Gemini | Completeness - document all prompts |
| Improved error messages (PRD_TOO_LARGE, QUEUE_TIMEOUT) | Gemini | More actionable user feedback |
