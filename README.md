# PRD Gauntlet MCP Server v4.0.1

An MCP server that enables Claude to orchestrate multi-model PRD refinement and build spec review. Claude defends documents against critiques from ChatGPT and Gemini until consensus is reached. All jobs run asynchronously — call the tool to start a job, then poll for results.

## Installation

```bash
npm install
npm run build
```

## Configuration

### Environment Variables

Copy `.env.example` to `.env` and add your API keys:

```bash
cp .env.example .env
```

Required:
- `ANTHROPIC_API_KEY` - Your Anthropic API key
- `OPENAI_API_KEY` - Your OpenAI API key
- `GOOGLE_AI_API_KEY` - Your Google AI API key

### Optional Configuration

Create `gauntlet.config.json` for additional settings (see `gauntlet.config.example.json`).

## Claude Desktop Integration

Add to your Claude Desktop config (`~/Library/Application Support/Claude/claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "prd-gauntlet": {
      "command": "node",
      "args": ["/path/to/prd-gauntlet-mcp/dist/index.js"],
      "env": {
        "ANTHROPIC_API_KEY": "sk-ant-...",
        "OPENAI_API_KEY": "sk-...",
        "GOOGLE_AI_API_KEY": "AIza..."
      }
    }
  }
}
```

## Usage

Jobs are **asynchronous** — tools that start a gauntlet return a `jobId` immediately. Poll `check_gauntlet_status` until status is `complete` or `consensus_failed`.

### PRD Refinement

1. Provide a PRD to Claude
2. Say: "Run this through the gauntlet"
3. Claude calls `run_prd_gauntlet` → receives `jobId`
4. Claude polls `check_gauntlet_status` until done
5. Receive the refined PRD with changelog

### Build Spec Review (v4.0)

Pass an app spec section and test spec to `review_build_specs`. Claude and critics check for ambiguity, coverage gaps, untested behaviors, and cross-document consistency. Returns refined versions of both documents plus a cross-document report.

## Tools

### `run_prd_gauntlet`

Start an async multi-model PRD refinement job. Returns `jobId` immediately.

**Input:**
- `prd` (required): PRD markdown content
- `metadata.title`: PRD title
- `metadata.productContext`: Background info for critics
- `metadata.constraints`: Known constraints to respect
- `config.maxRoundsPerModel`: Max rounds per critic (min: 2)
- `config.maxTotalTokens`: Token cap
- `config.maxEstimatedCost`: Cost cap in USD
- `config.includeTranscripts`: Include full transcripts (default: false)
- `config.transcriptSummaryOnly`: Return condensed summary instead of full transcript
- `config.targetedSections`: Specific sections to focus debate on
- `config.useFullConsensus`: Use 5-threshold consensus (default: true)
- `config.webhookUrl`: Webhook URL for completion notification
- `config.webhookAuth`: Webhook auth (`{ type: "bearer" | "hmac", token?: string }`)
- `config.models`: Override model versions (`{ claude?, chatgpt?, gemini? }`)

**Returns:** `{ jobId, status: "idle", jobType: "prd_refinement" }`

---

### `review_build_specs`

Start an async build spec review job. Claude and critics jointly review an app spec section and test spec for issues. Returns refined versions of both documents. Returns `jobId` immediately.

**Input:**
- `appSpecSection` (required): The app spec section to review
- `testSpec` (required): The test spec to review
- `buildRulesSpec`: Optional build rules for additional context
- `appSpec`: Optional full app spec for cross-document context
- `metadata.title`: Document title
- `metadata.version`: Document version
- `metadata.projectContext`: Background info for critics
- `metadata.constraints`: Known constraints to respect
- `config.maxRoundsPerModel`: Max rounds per critic (default: 3, min: 2)
- `config.maxTotalTokens`: Token cap
- `config.maxEstimatedCost`: Cost cap in USD
- `config.webhookUrl`: Webhook URL for completion notification
- `config.models`: Override model versions

**Returns:** `{ jobId, status: "idle", jobType: "build_spec_review" }`

---

### `check_gauntlet_status`

Poll a job for its current status and results.

**Input:**
- `jobId` (required): UUID returned by `run_prd_gauntlet` or `review_build_specs`

**Returns:** Status plus results when complete. For `prd_refinement`: `refinedPrd`, `summary`, optional `divergenceReport`. For `build_spec_review`: `refinedAppSpecSection`, `refinedTestSpec`, `crossDocumentReport`, `summary`.

**Statuses:** `idle` → `debating_chatgpt` → `debating_gemini` → `complete` | `consensus_failed` | `error`

---

### `list_jobs`

List in-memory jobs (lost on server restart).

**Input:**
- `status`: Filter by status (`"all"` | `"idle"` | `"debating_chatgpt"` | `"debating_gemini"` | `"complete"` | `"consensus_failed"` | `"error"`) — default: `"all"`
- `jobType`: Filter by type (`"all"` | `"prd_refinement"` | `"build_spec_review"`) — default: `"all"`
- `limit`: Max results (default: 50)

---

### `get_debate_transcript`

Retrieve the full debate transcript for a specific critic from a completed job.

**Input:**
- `jobId` (required): Job UUID
- `model` (required): `"chatgpt"` or `"gemini"`

---

### `save_job_output`

Manually save a completed in-memory job to disk (jobs are also auto-saved on completion).

**Input:**
- `jobId` (required): Job UUID

---

### `load_saved_job`

Load a previously saved job from disk (survives server restarts).

**Input:**
- `jobId` (required): Job UUID

---

### `list_saved_jobs`

List all jobs saved to disk.

**Input:** None

---

### `get_saved_prd`

Extract the final refined PRD or spec review output from a saved job, with optional file export.

**Input:**
- `jobId` (required): Job UUID
- `outputFile`: Optional file path to write the output to

---

### `clear_terminology_cache`

Invalidate the in-memory terminology research cache. Useful if domain terminology has changed between runs.

**Input:** None

---

### `gauntlet_health`

Check server health and provider availability.

**Input:**
- `forceRefresh`: Re-validate all providers (default: false)

## Common Errors

| Error | Cause | Solution |
|-------|-------|----------|
| `CONFIG_ERROR: Missing required environment variable` | API key not set | Add key to `.env` file |
| `PROVIDER_ERROR: Claude is unavailable` | Anthropic API issue | Check API key and status |
| `Maximum concurrent jobs reached` | Too many gauntlets running | Wait for current jobs to complete |

## Development

```bash
npm run dev      # Watch mode
npm run build    # Build
npm test         # Run tests
npm run lint     # Type check
```

## License

MIT
