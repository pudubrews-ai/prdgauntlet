# PRD Gauntlet MCP Server

An MCP server that enables Claude to orchestrate multi-model PRD refinement. When invoked, Claude defends a PRD against critiques from ChatGPT and Gemini until consensus is reached.

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

Once configured, ask Claude to run a PRD through the gauntlet:

1. Create or provide a PRD to Claude
2. Say: "Run this through the gauntlet"
3. Claude invokes `run_prd_gauntlet` and orchestrates debates
4. Receive the refined PRD with changelog

### Example

```
User: Here's my PRD for a new feature: [PRD content]

Claude: I'll run this through the gauntlet...

[Claude calls run_prd_gauntlet]

Claude: The gauntlet is complete! Here's the refined PRD with changes:
- v1 [chatgpt]: Added error handling section
- v2 [chatgpt]: Clarified scope boundaries
- v3 [gemini]: Added acceptance criteria to FR2
...
```

## Tools

### `run_prd_gauntlet`

Orchestrate multi-model PRD refinement.

**Input:**
- `prd` (required): PRD markdown content
- `metadata.title`: PRD title
- `metadata.productContext`: Background info for critics
- `metadata.constraints`: Known constraints to respect
- `config.maxRoundsPerModel`: Max rounds per critic (default: 5)
- `config.maxTotalTokens`: Token cap
- `config.maxEstimatedCost`: Cost cap in USD
- `config.includeTranscripts`: Include full transcripts (default: false)

### `gauntlet_health`

Check server health and provider status.

**Input:**
- `forceRefresh`: Re-validate providers (default: false)

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
