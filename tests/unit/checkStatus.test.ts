import { describe, it, expect, beforeEach } from 'vitest';
import { handleCheckStatus } from '../../src/tools/checkStatus.js';
import { jobStore } from '../../src/utils/jobStore.js';

describe('handleCheckStatus', () => {
  beforeEach(() => {
    jobStore.clear();
  });

  it('returns JOB_NOT_FOUND for non-existent job', () => {
    const result = handleCheckStatus({ jobId: '00000000-0000-0000-0000-000000000000' });
    expect(result).toHaveProperty('error', 'JOB_NOT_FOUND');
  });

  it('returns JOB_NOT_FOUND for invalid UUID format', () => {
    const result = handleCheckStatus({ jobId: 'not-a-uuid' });
    expect(result).toHaveProperty('error', 'JOB_NOT_FOUND');
  });

  it('returns idle status for new job', () => {
    const jobId = jobStore.create();
    const result = handleCheckStatus({ jobId });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('jobId', jobId);
    expect(result).toHaveProperty('status', 'idle');
  });

  it('returns progress info for debating job', () => {
    const jobId = jobStore.create();
    jobStore.updateDebateProgress(jobId, 'chatgpt', 2, '# Updated PRD', [
      { version: 1, source: 'chatgpt', round: 1, type: 'modification', summary: 'Test change' },
    ]);

    const result = handleCheckStatus({ jobId });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('status', 'debating_chatgpt');
    expect(result).toHaveProperty('currentRound', 2);
    expect(result).toHaveProperty('currentModel', 'chatgpt');
    expect(result).toHaveProperty('partialResult');
    expect((result as any).partialResult.currentPrd).toBe('# Updated PRD');
  });

  it('returns final PRD for completed job', () => {
    const jobId = jobStore.create();
    jobStore.complete(jobId, {
      jobId,
      finalPrd: '# Final Refined PRD\n\nThis is the refined content.',
      changelog: [
        { version: 1, source: 'chatgpt', round: 1, type: 'modification', summary: 'Added section' },
      ],
      stats: {
        totalRounds: 3,
        tokensUsed: { claude: 1000, chatgpt: 500, gemini: 500 },
        estimatedCost: 0.05,
      },
    });

    const result = handleCheckStatus({ jobId });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('status', 'complete');
    expect(result).toHaveProperty('refinedPrd');
    expect((result as any).refinedPrd).toContain('Final Refined PRD');
    expect(result).not.toHaveProperty('partialResult');
  });

  it('returns error status for failed job', () => {
    const jobId = jobStore.create();
    jobStore.fail(jobId, {
      error: 'PROVIDER_ERROR',
      message: 'OpenAI API failed',
    });

    const result = handleCheckStatus({ jobId });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('status', 'error');
  });
});
