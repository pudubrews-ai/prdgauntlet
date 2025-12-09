# PRD: PRD Gauntlet MCP Server

**Version:** 2.3  
**Status:** Final — Gauntlet Complete  
**Reviewed By:** ChatGPT (v1→v2→v2.1→v2.2 ✓), Gemini (v2.2→v2.3 ✓)

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
    maxTotalTokens?: number;      // Hard cap, early stop if exceeded
    maxEstimatedCost?: number;    // USD cap, early stop if exceeded
    includeTranscripts?: boolean; // Default: false
    models?: {
      chatgpt?: string;           // Default: "gpt-4o"
      gemini?: string;            // Default: "gemini-1.5-pro"
    }
  }
}
```

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
  error: "INVALID_INPUT" | "PROVIDER_ERROR" | "CONFIG_ERROR";
  message: string;
  details?: Record<string, unknown>;
}
```

**Acceptance Criteria:**
- Returns `finalPrd` even on early stop or max rounds
- `changelog.length >= 1` if any modifications occurred
- `stats.totalRounds` equals sum of rounds across all critics
- If all critics skipped, `debates` field is omitted (not empty object)

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

**Engine behavior:**
- Send PRD + defender prompt to Claude API
- Send PRD + critic prompt to ChatGPT/Gemini API
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

**Fuzzy substring matching is explicitly NOT used.**

---

### FR6: Conflict Resolution

Critics are engaged sequentially (ChatGPT → Gemini). Later critics may dispute changes made for earlier critics.

**Rules:**
- Source of truth is always the **latest Claude-revised PRD**
- Each critic sees only the current PRD + changelog summary (not full debate history)
- If Gemini objects to a change ChatGPT requested:
  - Claude evaluates both positions
  - Claude may revert the earlier change if Gemini's argument is stronger
  - Reversals are logged as new `ChangeEntry` items with `type: "revert"`
- Claude must justify reversals in the changelog

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
  diff?: string;              // Optional: actual diff
  revertedChange?: number;    // If type=revert, which version was reverted
}
```

**Defender JSON Contract:**
The defender emits a **round delta** in simplified format:
```typescript
{
  type: "addition" | "modification" | "deletion" | "revert";
  summary: string;
  section?: string;
}
```
The server enriches this into a full `ChangeEntry` by adding `version`, `source`, `round`, and `revertedChange` (if applicable).

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
  "models": {
    "claude": "claude-sonnet-4-5-20250929",
    "chatgpt": "gpt-4o",
    "gemini": "gemini-1.5-pro"
  },
  "prompts": {
    "defender": "path/to/custom-defender.md",
    "critic": "path/to/custom-critic.md"
  },
  "fallbackPolicy": {
    "onModelUnavailable": "skip",
    "onInvalidModelId": "error"
  },
  "costRates": {
    "claude": { "input": 3.00, "output": 15.00 },
    "chatgpt": { "input": 2.50, "output": 10.00 },
    "gemini": { "input": 1.25, "output": 5.00 }
  }
}
```

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
- **Rounding:** Rounded to nearest cent (USD) for display; full precision used for cap enforcement
- **Scope:** Cumulative across all API calls (Claude + ChatGPT + Gemini)
- **Maintenance:** Hardcoded rates should be reviewed and updated with each release when provider pricing changes.

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

**Phase 2:** Optional durable storage (Redis/SQLite) with restart recovery and configurable TTL.

---

## Non-Functional Requirements

### NFR1: Transparency
- Debate summaries always returned
- Full transcripts available on request via `get_debate_transcript`
- User can ask Claude to explain any change in the changelog

### NFR2: Timeout Handling
- Individual API calls timeout at 60s
- Total gauntlet timeout at 10 minutes
- Graceful degradation: return best PRD so far + partial results + unresolved concerns

### NFR3: Cost Efficiency
- Token count tracked per model per round
- Estimated cost calculated per FR10
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

**Redaction patterns (applied automatically):**
- Environment variable patterns: `ANTHROPIC_API_KEY=...`, `OPENAI_API_KEY=...`, `GOOGLE_AI_API_KEY=...`
- Bearer tokens: `/[Bb]earer\s+[A-Za-z0-9\-_]+/`
- API key patterns: `/api[_-]?key["']?\s*[:=]\s*["']?[A-Za-z0-9\-_]+/i`
- OpenAI-style keys: `/sk-[A-Za-z0-9]{20,}/`
- Generic secrets: `/secret["']?\s*[:=]\s*["']?[A-Za-z0-9\-_]+/i`

**Redaction scope:** Redaction runs only on persisted transcripts/PRDs when `persistHistory=true`. The `finalPrd` returned to Claude is never redacted — users see their original content.

**Disclaimer:** Regex-based redaction is not foolproof. Users should avoid including highly sensitive live credentials (production API keys, database passwords, etc.) in PRDs processed through this system. The redaction patterns catch common formats but cannot guarantee complete coverage.

---

## Failure Mode User Messaging

Claude should summarize failures to the user as follows:

| Scenario | Claude's Message |
|----------|------------------|
| Critic skipped (unavailable) | "Gemini was unavailable during this run; the PRD was reviewed by ChatGPT only." |
| Early stop (cost cap) | "The gauntlet stopped early due to cost limits. Here's the PRD so far, with these unresolved concerns: [list]. You may want to address these manually." |
| Early stop (token cap) | "The gauntlet stopped early due to token limits. [same as above]" |
| Max rounds (no consensus) | "ChatGPT and I couldn't reach full consensus after 5 rounds. Here's the final PRD with these outstanding concerns: [list]." |
| Job not found | "I couldn't find that gauntlet run — job history isn't preserved after server restarts." |
| Both critics skipped | "Neither ChatGPT nor Gemini were available. Here's the original PRD unchanged. Try again later or review manually." |

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
│   │   ├── defender.ts       # System prompt for Claude
│   │   └── critic.ts         # System prompt for critics
│   ├── types/
│   │   └── index.ts          # TypeScript interfaces
│   └── utils/
│       ├── changelog.ts      # Tracks revisions
│       ├── cost.ts           # Cost estimation per FR10
│       ├── logger.ts         # Structured logging (no PRD content by default)
│       ├── tokens.ts         # Token counting
│       └── redaction.ts      # Secret redaction patterns per NFR4
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
You are defending a PRD you authored. You will receive critique from another AI model.

For each piece of feedback:
1. If valid and improves the PRD → incorporate it
2. If based on misunderstanding → clarify and hold your ground
3. If stylistic preference → acknowledge but decline unless compelling
4. If out of scope → explain why and decline
5. If the critic's response is malformed, garbled, or contains invalid JSON → politely ask them to restate their feedback clearly

IMPORTANT: After addressing feedback, you MUST output in this exact format:

---BEGIN RESPONSE---
## Updated PRD
[Full updated PRD here]

## Changes This Round
```json
{
  "type": "addition|modification|deletion|revert",
  "summary": "Brief description of change",
  "section": "PRD header path, e.g., FR4 > Consensus Detection"
}
```

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

### Phase 3
- Parallel debates with merge policy (FR6)
- Critic severity tagging: Update critic prompt to prefix concerns with `[BLOCKER]`, `[GAP]`, `[CLARIFICATION]` for merge prioritization
- Additional model support via adapter interface
- Persistent history with redaction
- Web UI for debate visualization
- Requirements coverage rubric

---

## Appendix: Full Changelog

### v1 → v2 (ChatGPT Review)

| Change | Rationale |
|--------|-----------|
| Added structured consensus detection (exact match + JSON) | Fuzzy matching too brittle |
| Added Conflict Resolution section (FR6) | Later critics may dispute earlier changes |
| Made transcripts optional, added `includeTranscripts` flag | Prevent context bloat |
| Added `jobId` to output | Required for async operations |
| Added Security & Privacy NFR (NFR4) | PRDs may contain sensitive info |
| Added `maxTotalTokens` and `maxEstimatedCost` caps | Cost control guardrails |
| Formalized defender round output format | Deterministic parsing |
| Added objective quality checks to success metrics | Measurable quality improvement |
| Added model validation + fallback policy (FR9) | Operational robustness |
| Added `metadata` input field (title, context, constraints) | Better critic context |
| Added Out of Scope section | Clarify boundaries |
| Added `get_debate_transcript` tool (FR3) | Access transcripts when excluded from main output |

### v2 → v2.1 (ChatGPT Review Round 2)

| Change | Rationale |
|--------|-----------|
| Added FR11: Job Lifecycle with ephemeral behavior documented | Clarify MVP limitations |
| Added typed error responses (`JOB_NOT_FOUND`, `TRANSCRIPT_UNAVAILABLE`, `CRITIC_SKIPPED`) | Avoid silent failures |
| Added acceptance criteria to FR1, FR2, FR3 | Make testing unambiguous |
| Added defender JSON contract clarification in FR7 | Round delta vs full ChangeEntry |
| Added malformed JSON handling in FR5 | Edge case for critic responses |
| Added FR10: Cost Estimation with full detail | Tokens, rates, rounding |
| Added Phase 3 parallel merge policy hint in FR6 | Forward-looking design |
| Enumerated redaction patterns in NFR4 | Implementation clarity |
| Added Failure Mode User Messaging section | UX documentation for Claude |
| Made `debates` optional in output when all critics skipped | Cleaner response shape |
| Added `skippedCritics` to stats | Track fallback behavior |
| Specified section format as PRD header path | Consistent changelog reporting |

### v2.1 → v2.2 (ChatGPT Final Polish)

| Change | Rationale |
|--------|-----------|
| Specified `jobId` format as UUIDv4 | Avoid collisions, prepare for persistence |
| Added "round" definition in FR4 | Clarify critic → defender exchange |
| Added `maxRoundsPerModel` applies per critic clarification | Prevent ambiguity |
| Added `stoppedEarly.atModel` field | Debugging and UX clarity |
| Added typed error response for `run_prd_gauntlet` | Symmetrical tool contracts |
| Added redaction scope clarification in NFR4 | Prevent over-redaction of user output |
| Added severity tagging to Phase 3 scope | Support parallel merge prioritization |

### v2.2 → v2.3 (Gemini Review — Final)

| Change | Rationale |
|--------|-----------|
| Added metadata placeholders to Critic System Prompt | FR1 metadata wasn't being used in prompts |
| Added malformed input handling to Defender Prompt | Clarify Claude's responsibility for retry requests |
| Clarified FR10 cost rates as hardcoded defaults | Not live API lookups |
| Added section path best-effort note in FR7 | LLM output inconsistency is expected |
| Added server-side fuzzy matching to Phase 2 | Future normalization of section paths |
| Added diff-patch defender output to Phase 2 | Reduce token costs for large PRDs |
| Added redaction disclaimer in NFR4 | Regex isn't foolproof |
| Fixed FR2 `currentModel` to explicit enum | Type clarity |
