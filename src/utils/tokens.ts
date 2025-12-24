// ============================================================================
// Token Estimation - PRD size validation (FR1)
// ============================================================================

// Conservative estimate: ~4 characters per token for English text
// This is an approximation; actual tokenization varies by model
const CHARS_PER_TOKEN = 4;

// Claude 3.5 Sonnet context window: 200K tokens
// PRD v2.6 specifies: enforce at 80% of 160K = 128K tokens
const DEFAULT_MAX_PRD_TOKENS = 128_000;

/**
 * Estimate the number of tokens in a text string.
 * Uses a conservative character-based estimation (~4 chars/token).
 *
 * Note: This is an approximation. Actual token counts vary based on:
 * - Specific tokenizer used by each model
 * - Language and character set
 * - Code vs prose content
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Check if a PRD exceeds the recommended input size.
 *
 * @param prd - The PRD content to check
 * @param limit - Maximum allowed tokens (default: 128K per FR1)
 * @returns Object with validation result and token counts
 */
export function checkPrdSize(
  prd: string,
  limit: number = DEFAULT_MAX_PRD_TOKENS
): { ok: boolean; tokens: number; limit: number } {
  const tokens = estimateTokens(prd);
  return {
    ok: tokens <= limit,
    tokens,
    limit,
  };
}

/**
 * Get the default maximum PRD token limit.
 * Based on 80% of Claude's context window per FR1.
 */
export function getDefaultMaxPrdTokens(): number {
  return DEFAULT_MAX_PRD_TOKENS;
}
