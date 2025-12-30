import { describe, it, expect, beforeEach } from 'vitest';
import { handleListJobs } from '../../src/tools/listJobs.js';
import { jobStore } from '../../src/utils/jobStore.js';

describe('handleListJobs', () => {
  beforeEach(() => {
    jobStore.clear();
  });

  it('returns empty list when no jobs exist', () => {
    const result = handleListJobs({});
    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns all jobs by default', () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.updateStatus(job2, 'complete');

    const result = handleListJobs({});
    expect(result.jobs).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('returns full UUIDs for job recovery', () => {
    const jobId = jobStore.create();

    const result = handleListJobs({});
    expect(result.jobs[0].jobId).toBe(jobId);
    expect(result.jobs[0].jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('filters by idle status', () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.updateStatus(job2, 'complete');

    const result = handleListJobs({ status: 'idle' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.total).toBe(1);
  });

  it('filters by debating_chatgpt status', () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.updateDebateProgress(job1, 'chatgpt', 1, '# PRD', []);

    const result = handleListJobs({ status: 'debating_chatgpt' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.jobs[0].status).toBe('debating_chatgpt');
  });

  it('filters by complete status', () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.complete(job1, {
      jobId: job1,
      finalPrd: '# Final PRD',
      changelog: [],
      stats: { totalRounds: 2, tokensUsed: { claude: 0, chatgpt: 0, gemini: 0 }, estimatedCost: 0 },
    });

    const result = handleListJobs({ status: 'complete' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.jobs[0].status).toBe('complete');
  });

  it('filters by error status', () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.fail(job1, { error: 'PROVIDER_ERROR', message: 'Failed' });

    const result = handleListJobs({ status: 'error' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.jobs[0].status).toBe('error');
  });

  it('respects limit parameter', () => {
    jobStore.create();
    jobStore.create();
    jobStore.create();

    const result = handleListJobs({ limit: 2 });
    expect(result.jobs).toHaveLength(2);
    expect(result.total).toBe(3); // total shows actual count before limit
  });

  it('sorts by lastUpdate descending (most recent first)', async () => {
    const job1 = jobStore.create();
    // Small delay to ensure different timestamps
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job2 = jobStore.create();
    await new Promise((resolve) => setTimeout(resolve, 10));
    const job3 = jobStore.create();

    const result = handleListJobs({});
    expect(result.jobs[0].jobId).toBe(job3);
    expect(result.jobs[1].jobId).toBe(job2);
    expect(result.jobs[2].jobId).toBe(job1);
  });

  it('includes progress info for debating jobs', () => {
    const jobId = jobStore.create();
    jobStore.updateDebateProgress(jobId, 'gemini', 3, '# PRD', []);

    const result = handleListJobs({});
    expect(result.jobs[0].currentRound).toBe(3);
    expect(result.jobs[0].currentModel).toBe('gemini');
  });

  it('includes createdAt and lastUpdate timestamps', () => {
    const jobId = jobStore.create();

    const result = handleListJobs({});
    expect(result.jobs[0].createdAt).toBeDefined();
    expect(result.jobs[0].lastUpdate).toBeDefined();
    expect(new Date(result.jobs[0].createdAt).getTime()).not.toBeNaN();
    expect(new Date(result.jobs[0].lastUpdate).getTime()).not.toBeNaN();
  });

  it('uses default limit of 50 when not specified', () => {
    // Temporarily increase max concurrent jobs for this test
    jobStore.setMaxConcurrentJobs(100);

    // Create 60 jobs
    for (let i = 0; i < 60; i++) {
      jobStore.create();
    }

    const result = handleListJobs({});
    expect(result.jobs).toHaveLength(50);
    expect(result.total).toBe(60);

    // Reset for other tests
    jobStore.setMaxConcurrentJobs(3);
  });

  it('handles status=all explicitly', () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.updateStatus(job2, 'complete');

    const result = handleListJobs({ status: 'all' });
    expect(result.jobs).toHaveLength(2);
  });
});
