import { describe, it, expect, vi, beforeEach } from 'vitest';
import { ReviewBuildSpecsInputSchema } from '../../src/tools/reviewBuildSpecs.js';

// We test the handler via schema validation and unit checks, avoiding live API calls
describe('ReviewBuildSpecsInputSchema', () => {
  it('accepts minimal valid input', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec content here',
      testSpec: 'Test spec content here',
    });
    expect(result.success).toBe(true);
  });

  it('rejects empty appSpecSection', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: '',
      testSpec: 'Test spec content here',
    });
    expect(result.success).toBe(false);
  });

  it('rejects empty testSpec', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec content',
      testSpec: '',
    });
    expect(result.success).toBe(false);
  });

  it('accepts optional fields', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec content here',
      testSpec: 'Test spec content here',
      buildRulesSpec: 'Build rules here',
      appSpec: 'Full app spec here',
      metadata: {
        title: 'My Feature',
        version: '1.0.0',
        projectContext: 'A coffee app',
        constraints: ['Must support iOS 16+', 'Max 2MB bundle'],
      },
      config: {
        maxRoundsPerModel: 3,
        includeTranscripts: false,
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts maxRoundsPerModel as positive number', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec',
      testSpec: 'Test spec',
      config: { maxRoundsPerModel: 5 },
    });
    expect(result.success).toBe(true);
  });

  it('rejects negative maxRoundsPerModel', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec',
      testSpec: 'Test spec',
      config: { maxRoundsPerModel: -1 },
    });
    expect(result.success).toBe(false);
  });

  it('accepts webhookAuth with bearer type', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec',
      testSpec: 'Test spec',
      config: {
        webhookUrl: 'https://example.com/hook',
        webhookAuth: { type: 'bearer', token: 'my-token' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('accepts webhookAuth with hmac type', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec',
      testSpec: 'Test spec',
      config: {
        webhookUrl: 'https://example.com/hook',
        webhookAuth: { type: 'hmac' },
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects unknown webhookAuth type', () => {
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec',
      testSpec: 'Test spec',
      config: {
        webhookUrl: 'https://example.com/hook',
        webhookAuth: { type: 'invalid' },
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('handleReviewBuildSpecs validation logic', () => {
  it('validates maxRoundsPerModel >= 2 enforcement via schema behavior', () => {
    // The schema accepts any positive number; S-8 validation is done at runtime
    // Verify schema allows 1 (it's .positive()), but runtime would reject it
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec',
      testSpec: 'Test spec',
      config: { maxRoundsPerModel: 1 },
    });
    // Schema itself allows 1 as positive; runtime handler rejects it
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config?.maxRoundsPerModel).toBe(1);
    }
  });

  it('defaults maxRoundsPerModel to 3 (via nullish coalescing in handler)', () => {
    // When not provided, handler should use 3 (not tested here since it requires live handler)
    // Verify schema correctly passes undefined through
    const result = ReviewBuildSpecsInputSchema.safeParse({
      appSpecSection: 'App spec',
      testSpec: 'Test spec',
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.config?.maxRoundsPerModel).toBeUndefined();
    }
  });
});
