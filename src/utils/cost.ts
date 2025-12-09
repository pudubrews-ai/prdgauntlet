// ============================================================================
// Cost Tracking - Token counting and cost estimation (FR10)
// ============================================================================

import type { CostRates, ModelName } from '../types/index.js';

// Default rates per 1M tokens (as of release)
export const DEFAULT_COST_RATES: CostRates = {
  claude: { input: 3.0, output: 15.0 },
  chatgpt: { input: 2.5, output: 10.0 },
  gemini: { input: 1.25, output: 5.0 },
};

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

  hasExceededCostCap(cap: number): boolean {
    // Use full precision for enforcement
    return this.getTotalCost() >= cap;
  }

  hasExceededTokenCap(cap: number): boolean {
    return this.getTotalTokens() >= cap;
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
