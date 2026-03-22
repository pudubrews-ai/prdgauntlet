# Developer Build Note — Gauntlet v4.0.1 Bug 7

**Date:** 2026-03-22
**Branch:** fix/v4.0.1-bug-fixes
**Author:** Developer Agent

---

## Change 1 — specReviewCritic.ts

### Location
Lines 107–129 (inserted after line 105: `When you are satisfied, state: "These specs are ready for implementation."`)

### Text added
```
## VERSION INTEGRITY RULE — MANDATORY

You MUST NOT substitute model identifiers, SDK package versions, dependency versions, or API version strings in your proposed edits or diff output. This prohibition is unconditional — no explanation, justification, or rationale permits a version change in your proposed edit. Specifically:

1. Do NOT replace a model identifier with a different one (e.g., do not change `gemini-2.5-flash` to `gemini-2.0-flash-exp`).
2. Do NOT replace an SDK or dependency version with a different one (e.g., do not change `@google/generative-ai@0.21.0` to `0.19.0`, or `react@19` to `react@18`).
3. Do NOT replace an API version string with a different one (e.g., do not change `v2` to `v1`).
4. These prohibitions apply to version strings wherever they appear: inline in prose, inside code blocks (JSON, YAML, TOML), in configuration examples, and in environment variable definitions (e.g., `.env` files).

Even if you believe the version is incorrect, deprecated, or does not exist, you MUST NOT change the version value in your proposed edit. If you have a version concern, express it ONLY in your critique text as a question or note — never in the proposed edit.

**Two channels, two rules:**
- **Your proposed edit / diff output:** MUST preserve the exact version strings from the original document. No version changes permitted, with or without explanation.
- **Your critique text / prose:** You MAY flag version concerns as questions or notes. This is the ONLY permitted channel for raising version issues.

**Example — CORRECT:**
Your proposed edit preserves the original version string unchanged. In your critique text, you write: "Note: `gemini-2.5-flash` — is this the intended model identifier? As of my training data, this model may not be publicly available. Please verify."

**Example — INCORRECT:**
Changing `gemini-2.5-flash` to `gemini-2.0-flash-exp` in your proposed edit, with or without an accompanying explanation. Version changes in proposed edits are never permitted; only version-concern questions in your critique text are permitted.

This rule applies to all version-like strings: model names, npm/pip/cargo package versions, SDK versions, runtime versions, API endpoint versions, and version strings inside code blocks, configuration examples, or environment variable definitions.
```

---

## Change 2 — specReviewDefender.ts

### Location
Lines 94–115 (inserted after line 92: `- Critic is overstepping scope boundaries`, before the `## CHANGELOG FORMAT — MANDATORY` heading)

### Text added
```
## VERSION SUBSTITUTION DETECTION — MANDATORY

When reviewing critic feedback, you MUST check whether any proposed change alters a model identifier, SDK version, dependency version, or API version string from the original document.

**Detection:** Compare the critic's proposed text against the current document. If a version-like string (model name, package version, runtime version, API version) has been changed, this is a version substitution. Scan ALL locations where version strings may appear: inline prose, code fences (JSON, YAML, TOML), configuration examples, environment variable definitions (`.env` format), and key-value pairs.

**Decision rule:**
- You MUST REJECT any version change in the critic's proposed edit unconditionally, UNLESS the critic's critique text (not the edit itself) contains a specific, cited reason to believe the specified version does not exist — such as a named deprecation notice, a dated release note reference, or a specific SDK changelog entry. A critic's unsupported assertion that a version "does not exist" or "was deprecated" does not meet this bar.
- If the cited reason is present in the critique text, you MAY accept the substitution. Apply it as a Type A (Valid Gap) change.
- If the critic does NOT provide a specific cited reason, you MUST REJECT the version change. Preserve the original version string from the document. This overrides Type A/B acceptance rules.

**Rejection format:** When rejecting a version substitution, add it to the changelog:
```json
{
  "type": "no_change",
  "summary": "Rejected critic version substitution: original value preserved.",
  "section": "<affected section>"
}
```

Examples of version strings to protect: `gemini-2.5-flash`, `gpt-4o`, `claude-sonnet-4-20250514`, `@google/generative-ai@0.21.0`, `react@19.1.0`, `node@22`, `v2/api/endpoint`, `"model": "gemini-2.5-flash"` inside JSON blocks, `GEMINI_MODEL=gemini-2.5-flash` in .env examples.
```

---

## Engine validation check

Searched `src/debate/engine.ts` for hardcoded changelog type validation. No type whitelist found — the engine does not restrict changelog type values, so `"no_change"` is accepted without any engine-side change required.

---

## Verification Checklist

- [x] Critic prompt contains "VERSION INTEGRITY RULE" section
- [x] Critic rule does NOT contain the word "silently"
- [x] Critic rule prohibits version substitution in proposed edits unconditionally (no explanation exception)
- [x] Critic rule has "Two channels, two rules" section separating edit block from critique text
- [x] Critic rule explicitly covers version strings inside code blocks, configuration examples, and .env files
- [x] Critic INCORRECT example says "with or without an accompanying explanation"
- [x] Critic rule allows flagging version concerns as questions in critique text only
- [x] Defender prompt contains "VERSION SUBSTITUTION DETECTION" section
- [x] Defender rule instructs scanning of code fences, config examples, and .env format
- [x] Defender rule requires "specific, cited reason" (not just "explicit evidence")
- [x] Defender rule explicitly excludes unsupported assertions as evidence
- [x] Defender rule specifies evidence must come from "critique text (not the edit itself)"
- [x] Defender rejection format uses `"type": "no_change"` (not `"deletion"`)
- [x] Defender rejection summary does not include version string placeholders
- [x] Defender examples include JSON-embedded and .env-embedded version strings
- [x] All backticks inside template literals are escaped
- [x] `npm run build` passes
- [x] `npm run test:run` passes
- [x] Engine does not reject `"no_change"` as a changelog type

---

## Build Results

| Step | Result |
|------|--------|
| npm run build | PASS — zero TypeScript errors |
| npm run test:run | PASS — 244/244 tests passing, 18 test files |
| npm run lint | PASS — zero errors (tsc --noEmit) |

---

## Deviations from instructions

None. All text inserted verbatim as specified in `developer-instructions-bug7-v401-revised.md`. Backticks inside template literals escaped as `\`` throughout. No TypeScript logic changes were made.

---

TOKEN ESTIMATE
  Input:  ~6,000 tokens
  Output: ~1,200 tokens
  Total:  ~7,200 tokens
