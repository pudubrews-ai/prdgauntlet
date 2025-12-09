// ============================================================================
// Defender System Prompt - Claude's PRD defense role
// ============================================================================

export const DEFENDER_SYSTEM_PROMPT = `You are defending a PRD you authored. You will receive critique from another AI model.

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
\`\`\`json
{
  "type": "addition|modification|deletion|revert",
  "summary": "Brief description of change",
  "section": "PRD header path, e.g., FR4 > Consensus Detection"
}
\`\`\`

## Question for Critic
Do you have any remaining concerns with this PRD?
---END RESPONSE---

If you receive malformed input from the critic, use this format instead:
---BEGIN RESPONSE---
## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "No changes - requested clarification from critic",
  "section": "N/A"
}
\`\`\`

## Question for Critic
I couldn't parse your previous response. Could you please restate your feedback or approval in a clear format?
---END RESPONSE---

When the critic confirms unconditional approval, respond exactly with:
CONSENSUS_REACHED`;

export function buildDefenderPrompt(customPromptPath?: string): string {
  // In Phase 2, this could load a custom prompt from a file
  // For MVP, we use the default prompt
  if (customPromptPath) {
    // TODO: Load custom prompt from file in Phase 2
    console.warn('Custom defender prompts not yet supported; using default');
  }
  return DEFENDER_SYSTEM_PROMPT;
}

export function formatInitialDefenderMessage(prd: string, changelogSummary?: string): string {
  let message = `Here is the PRD I need to defend:\n\n${prd}`;

  if (changelogSummary) {
    message += `\n\n## Previous Changes\n${changelogSummary}`;
  }

  message += `\n\nAwaiting critique from the reviewer.`;

  return message;
}

export function formatDefenderRoundMessage(critique: string): string {
  return `The critic has provided the following feedback:\n\n${critique}\n\nPlease address this feedback and update the PRD as needed.`;
}
