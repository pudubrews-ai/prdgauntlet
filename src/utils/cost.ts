// ============================================================================
// Cost Tracking - Token counting and cost estimation (PRD v3.0)
// ============================================================================

import type { CostRates, ModelName } from '../types/index.js';
import { logger } from './logger.js';

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

/**
 * Rolling average tracker for cost estimation (PRD v3.0)
 * Tracks last 100 jobs per model to calculate realistic token averages
 */
class RollingAverageTracker {
  private samples: Map<ModelName, number[]> = new Map();
  private maxSamples = 100; // Rolling window

  addSample(model: ModelName, tokens: number): void {
    const modelSamples = this.samples.get(model) || [];
    modelSamples.push(tokens);

    // Keep last 100 samples
    if (modelSamples.length > this.maxSamples) {
      modelSamples.shift();
    }

    this.samples.set(model, modelSamples);

    logger.logDebug('Cost sample added', {
      model,
      tokens,
      sampleCount: modelSamples.length,
    });
  }

  getAverage(model: ModelName): number | null {
    const samples = this.samples.get(model);
    if (!samples || samples.length === 0) {
      return null;
    }

    const sum = samples.reduce((a, b) => a + b, 0);
    return sum / samples.length;
  }

  getStats(): { model: ModelName; avgTokens: number; sampleCount: number }[] {
    const stats: { model: ModelName; avgTokens: number; sampleCount: number }[] = [];

    for (const [model, samples] of this.samples.entries()) {
      if (samples.length > 0) {
        const sum = samples.reduce((a, b) => a + b, 0);
        stats.push({
          model,
          avgTokens: Math.round(sum / samples.length),
          sampleCount: samples.length,
        });
      }
    }

    return stats;
  }
}

// Global rolling average tracker
export const rollingAverageTracker = new RollingAverageTracker();

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

  /**
   * Record job completion for rolling average calculation (PRD v3.0)
   */
  recordJobCompletion(): void {
    const tokensByModel = this.getTokenCountByModel();

    for (const [model, tokens] of Object.entries(tokensByModel)) {
      if (tokens > 0) {
        rollingAverageTracker.addSample(model as ModelName, tokens);
      }
    }
  }

  /**
   * Get rolling average stats (PRD v3.0)
   */
  static getRollingAverageStats(): { model: ModelName; avgTokens: number; sampleCount: number }[] {
    return rollingAverageTracker.getStats();
  }
}
