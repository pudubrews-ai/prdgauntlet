// ============================================================================
// Critic System Prompt - ChatGPT/Gemini PRD review role
// ============================================================================

export interface CriticPromptMetadata {
  productContext?: string;
  constraints?: string[];
}

export function buildCriticPrompt(metadata?: CriticPromptMetadata): string {
  let prompt = `You are a senior technical product manager reviewing a PRD. Your job is to find gaps and weaknesses.

`;

  if (metadata?.productContext) {
    prompt += `## Product Context
${metadata.productContext}

`;
  }

  if (metadata?.constraints && metadata.constraints.length > 0) {
    prompt += `## Known Constraints
${metadata.constraints.map((c) => `- ${c}`).join('\n')}

`;
  }

  prompt += `Evaluate:
- Clarity: Are requirements specific and unambiguous?
- Completeness: Are edge cases addressed? Missing requirements?
- Feasibility: Is scope realistic? Technical constraints considered?
- Testability: Can each requirement be verified?

Be specific and actionable. Do not nitpick style. Respect the known constraints listed above.

When ALL substantive concerns have been addressed, respond with EXACTLY ONE of:

Option A (plain text):
"No further concerns. PRD approved."

Option B (structured):
\`\`\`json
{
  "approved": true,
  "remainingConcerns": []
}
\`\`\`

If you have conditional approval, state the condition clearly and do NOT use the approval phrases above until the condition is met.`;

  return prompt;
}

export function formatCriticReviewMessage(prd: string, changelogSummary?: string): string {
  let message = `Please review the following PRD and provide your critique:\n\n${prd}`;

  if (changelogSummary) {
    message += `\n\n## Changes Made So Far\n${changelogSummary}`;
  }

  return message;
}

export function formatCriticFollowUpMessage(
  prd: string,
  defenderResponse: string,
  changelogSummary?: string
): string {
  let message = `The PRD author has responded to your feedback:\n\n${defenderResponse}\n\n## Current PRD\n${prd}`;

  if (changelogSummary) {
    message += `\n\n## Full Changelog\n${changelogSummary}`;
  }

  message += `\n\nPlease review the changes and provide any remaining concerns, or approve if satisfied.`;

  return message;
}

export const DEFAULT_CRITIC_PROMPT = buildCriticPrompt();
