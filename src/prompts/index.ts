// ============================================================================
// Prompts - Re-exports
// ============================================================================

export {
  DEFENDER_SYSTEM_PROMPT,
  buildDefenderPrompt,
  formatInitialDefenderMessage,
  formatDefenderRoundMessage,
} from './defender.js';

export {
  buildCriticPrompt,
  formatCriticReviewMessage,
  formatCriticFollowUpMessage,
  DEFAULT_CRITIC_PROMPT,
  type CriticPromptMetadata,
} from './critic.js';
