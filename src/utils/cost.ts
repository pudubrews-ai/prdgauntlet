// ============================================================================
// Cost Tracking - Token counting and cost estimation (FR10)
// ============================================================================

import type { CostRates, ModelName } from '../types/index.js';

// Default rates per 1M tokens (as of release)
// Per PRD v2.6: Product owner reviews rates quarterly
export const DEFAULT_COST_RATES: CostRates = {
  claude: { input: 3.0, output: 15.0 },
  chatgpt: { input: 2.5, output: 10.0 },
  gemini: { input: 1.25, output: 5.0 },
};

// FR10: 10% safety margin on cost estimates to account for tokenization variations
const SAFETY_MARGIN = 0.10;

// FR10: Warning threshold at 80% of cost cap
const WARNING_THRESHOLD = 0.80;

interface TokenUsage {
  input: number;
  output: number;
}

interface ModelTokens {
  claude: TokenUsage;
  chatgpt: TokenUsage;
  gemini: TokenUsage;
}

export class CostTracker {
  private tokens: ModelTokens;
  private rates: CostRates;

  constructor(rates: CostRates = DEFAULT_COST_RATES) {
    this.rates = rates;
    this.tokens = {
      claude: { input: 0, output: 0 },
      chatgpt: { input: 0, output: 0 },
      gemini: { input: 0, output: 0 },
    };
  }

  addTokens(model: ModelName, input: number, output: number): void {
    this.tokens[model].input += input;
    this.tokens[model].output += output;
  }

  getTotalTokens(): number {
    return (
      this.tokens.claude.input +
      this.tokens.claude.output +
      this.tokens.chatgpt.input +
      this.tokens.chatgpt.output +
      this.tokens.gemini.input +
      this.tokens.gemini.output
    );
  }

  getTokensByModel(): ModelTokens {
    return { ...this.tokens };
  }

  getTokenCountByModel(): { claude: number; chatgpt: number; gemini: number } {
    return {
      claude: this.tokens.claude.input + this.tokens.claude.output,
      chatgpt: this.tokens.chatgpt.input + this.tokens.chatgpt.output,
      gemini: this.tokens.gemini.input + this.tokens.gemini.output,
    };
  }

  private calculateModelCost(model: ModelName): number {
    const usage = this.tokens[model];
    const rate = this.rates[model];
    return (usage.input / 1_000_000) * rate.input + (usage.output / 1_000_000) * rate.output;
  }

  getTotalCost(): number {
    return (
      this.calculateModelCost('claude') +
      this.calculateModelCost('chatgpt') +
      this.calculateModelCost('gemini')
    );
  }

  getEstimatedCostRounded(): number {
    // Round to nearest cent for display
    return Math.round(this.getTotalCost() * 100) / 100;
  }

  /**
   * Get the total cost with 10% safety margin applied.
   * Per FR10: Safety margin accounts for tokenization variations.
   */
  getCostWithSafetyMargin(): number {
    return this.getTotalCost() * (1 + SAFETY_MARGIN);
  }

  /**
   * Check if cost (with safety margin) has exceeded the cap.
   * Per FR10: Uses full precision for enforcement.
   */
  hasExceededCostCap(cap: number): boolean {
    return this.getCostWithSafetyMargin() >= cap;
  }

  hasExceededTokenCap(cap: number): boolean {
    return this.getTotalTokens() >= cap;
  }

  /**
   * Check if cost is approaching 80% of the cap.
   * Per FR10: Triggers warning visible to user via Claude's response.
   */
  isApproaching80PercentCap(cap: number): boolean {
    const costWithMargin = this.getCostWithSafetyMargin();
    return costWithMargin >= cap * WARNING_THRESHOLD && costWithMargin < cap;
  }

  getCostBreakdown(): { claude: number; chatgpt: number; gemini: number; total: number } {
    return {
      claude: this.calculateModelCost('claude'),
      chatgpt: this.calculateModelCost('chatgpt'),
      gemini: this.calculateModelCost('gemini'),
      total: this.getTotalCost(),
    };
  }

  reset(): void {
    this.tokens = {
      claude: { input: 0, output: 0 },
      chatgpt: { input: 0, output: 0 },
      gemini: { input: 0, output: 0 },
    };
  }
}
