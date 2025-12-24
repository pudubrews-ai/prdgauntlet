import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker, DEFAULT_COST_RATES } from '../../src/utils/cost.js';

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  describe('token tracking', () => {
    it('should start with zero tokens', () => {
      expect(tracker.getTotalTokens()).toBe(0);
    });

    it('should track tokens by model', () => {
      tracker.addTokens('claude', 100, 50);
      tracker.addTokens('chatgpt', 200, 100);
      tracker.addTokens('gemini', 150, 75);

      const byModel = tracker.getTokensByModel();
      expect(byModel.claude).toEqual({ input: 100, output: 50 });
      expect(byModel.chatgpt).toEqual({ input: 200, output: 100 });
      expect(byModel.gemini).toEqual({ input: 150, output: 75 });
    });

    it('should accumulate tokens', () => {
      tracker.addTokens('claude', 100, 50);
      tracker.addTokens('claude', 100, 50);

      const byModel = tracker.getTokensByModel();
      expect(byModel.claude).toEqual({ input: 200, output: 100 });
    });

    it('should calculate total tokens correctly', () => {
      tracker.addTokens('claude', 100, 50);
      tracker.addTokens('chatgpt', 200, 100);

      expect(tracker.getTotalTokens()).toBe(450);
    });
  });

  describe('cost calculation', () => {
    it('should calculate cost using default rates', () => {
      // Add 1M input tokens to Claude
      tracker.addTokens('claude', 1_000_000, 0);

      // Expected: $3.00 per 1M input tokens
      expect(tracker.getTotalCost()).toBeCloseTo(3.0);
    });

    it('should calculate combined input/output cost', () => {
      // 1M input + 1M output for Claude
      tracker.addTokens('claude', 1_000_000, 1_000_000);

      // Expected: $3.00 (input) + $15.00 (output) = $18.00
      expect(tracker.getTotalCost()).toBeCloseTo(18.0);
    });

    it('should calculate cost across all models', () => {
      tracker.addTokens('claude', 1_000_000, 0); // $3.00
      tracker.addTokens('chatgpt', 1_000_000, 0); // $2.50
      tracker.addTokens('gemini', 1_000_000, 0); // $1.25

      expect(tracker.getTotalCost()).toBeCloseTo(6.75);
    });

    it('should round to nearest cent for display', () => {
      tracker.addTokens('claude', 333_333, 0); // ~$1.00

      const rounded = tracker.getEstimatedCostRounded();
      expect(rounded).toBe(1.0);
    });

    it('should return cost breakdown by model', () => {
      tracker.addTokens('claude', 1_000_000, 0);
      tracker.addTokens('chatgpt', 1_000_000, 0);

      const breakdown = tracker.getCostBreakdown();
      expect(breakdown.claude).toBeCloseTo(3.0);
      expect(breakdown.chatgpt).toBeCloseTo(2.5);
      expect(breakdown.gemini).toBe(0);
      expect(breakdown.total).toBeCloseTo(5.5);
    });
  });

  describe('cap enforcement', () => {
    it('should detect when token cap is exceeded', () => {
      tracker.addTokens('claude', 50000, 50000);

      expect(tracker.hasExceededTokenCap(100000)).toBe(true);
      expect(tracker.hasExceededTokenCap(100001)).toBe(false);
    });

    it('should detect when cost cap is exceeded (with 10% safety margin)', () => {
      // Add tokens that cost $3.00
      // 1M tokens @ $3/1M = $3.00
      // With 10% margin: $3.30
      tracker.addTokens('claude', 1_000_000, 0);

      // $3.30 exceeds $3.00 cap
      expect(tracker.hasExceededCostCap(3.0)).toBe(true);
      // $3.30 does not exceed $4.00 cap
      expect(tracker.hasExceededCostCap(4.0)).toBe(false);
    });

    it('should use full precision for cap enforcement with 10% safety margin', () => {
      // Add tokens worth $0.90
      // With 10% safety margin: $0.90 * 1.10 = $0.99
      tracker.addTokens('claude', 300_000, 0); // 300K @ $3/1M = $0.90

      // Should NOT exceed $1.00 cap (with margin: $0.99 < $1.00)
      expect(tracker.hasExceededCostCap(1.0)).toBe(false);

      // Add more to push over the margin
      tracker.addTokens('claude', 100_000, 0); // Now at $1.20, with margin: $1.32
      expect(tracker.hasExceededCostCap(1.0)).toBe(true);
    });
  });

  describe('custom rates', () => {
    it('should accept custom cost rates', () => {
      const customRates = {
        claude: { input: 10.0, output: 30.0 },
        chatgpt: { input: 5.0, output: 20.0 },
        gemini: { input: 2.5, output: 10.0 },
      };

      const customTracker = new CostTracker(customRates);
      customTracker.addTokens('claude', 1_000_000, 0);

      expect(customTracker.getTotalCost()).toBeCloseTo(10.0);
    });
  });

  describe('reset', () => {
    it('should reset all counters', () => {
      tracker.addTokens('claude', 1000, 500);
      tracker.addTokens('chatgpt', 2000, 1000);

      tracker.reset();

      expect(tracker.getTotalTokens()).toBe(0);
      expect(tracker.getTotalCost()).toBe(0);
    });
  });

  describe('getTokenCountByModel', () => {
    it('should return total tokens per model', () => {
      tracker.addTokens('claude', 100, 50);
      tracker.addTokens('chatgpt', 200, 100);
      tracker.addTokens('gemini', 150, 75);

      const counts = tracker.getTokenCountByModel();
      expect(counts.claude).toBe(150);
      expect(counts.chatgpt).toBe(300);
      expect(counts.gemini).toBe(225);
    });
  });
});

describe('DEFAULT_COST_RATES', () => {
  it('should have correct default rates', () => {
    expect(DEFAULT_COST_RATES.claude).toEqual({ input: 3.0, output: 15.0 });
    expect(DEFAULT_COST_RATES.chatgpt).toEqual({ input: 2.5, output: 10.0 });
    expect(DEFAULT_COST_RATES.gemini).toEqual({ input: 1.25, output: 5.0 });
  });
});
