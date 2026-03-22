import { describe, it, expect, beforeEach } from 'vitest';
import { handleListJobs } from '../../src/tools/listJobs.js';
import { jobStore } from '../../src/utils/jobStore.js';

describe('handleListJobs', () => {
  beforeEach(() => {
    jobStore.clear();
  });

  it('returns empty list when no jobs exist', async () => {
    const result = await handleListJobs({});
    expect(result.jobs).toEqual([]);
    expect(result.total).toBe(0);
  });

  it('returns all jobs by default', async () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.updateStatus(job2, 'complete');

    const result = await handleListJobs({});
    expect(result.jobs).toHaveLength(2);
    expect(result.total).toBe(2);
  });

  it('returns full UUIDs for job recovery', async () => {
    const jobId = jobStore.create();

    const result = await handleListJobs({});
    expect(result.jobs[0].jobId).toBe(jobId);
    expect(result.jobs[0].jobId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/
    );
  });

  it('filters by idle status', async () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.updateStatus(job2, 'complete');

    const result = await handleListJobs({ status: 'idle' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.total).toBe(1);
  });

  it('filters by debating_chatgpt status', async () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.updateDebateProgress(job1, 'chatgpt', 1, '# PRD', []);

    const result = await handleListJobs({ status: 'debating_chatgpt' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.jobs[0].status).toBe('debating_chatgpt');
  });

  it('filters by complete status', async () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.complete(job1, {
      jobId: job1,
      finalPrd: '# Final PRD',
      changelog: [],
      stats: { totalRounds: 2, tokensUsed: { claude: 0, chatgpt: 0, gemini: 0 }, estimatedCost: 0 },
    });

    const result = await handleListJobs({ status: 'complete' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.jobs[0].status).toBe('complete');
  });

  it('filters by error status', async () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.fail(job1, { error: 'PROVIDER_ERROR', message: 'Failed' });

    const result = await handleListJobs({ status: 'error' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.jobs[0].status).toBe('error');
  });

  it('respects limit parameter', async () => {
    jobStore.create();
    jobStore.create();
    jobStore.create();

    const result = await handleListJobs({ limit: 2 });
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

    const result = await handleListJobs({});
    expect(result.jobs[0].jobId).toBe(job3);
    expect(result.jobs[1].jobId).toBe(job2);
    expect(result.jobs[2].jobId).toBe(job1);
  });

  it('includes progress info for debating jobs', async () => {
    const jobId = jobStore.create();
    jobStore.updateDebateProgress(jobId, 'gemini', 3, '# PRD', []);

    const result = await handleListJobs({});
    expect(result.jobs[0].currentRound).toBe(3);
    expect(result.jobs[0].currentModel).toBe('gemini');
  });

  it('includes createdAt and lastUpdate timestamps', async () => {
    const jobId = jobStore.create();

    const result = await handleListJobs({});
    expect(result.jobs[0].createdAt).toBeDefined();
    expect(result.jobs[0].lastUpdate).toBeDefined();
    expect(new Date(result.jobs[0].createdAt).getTime()).not.toBeNaN();
    expect(new Date(result.jobs[0].lastUpdate).getTime()).not.toBeNaN();
  });

  it('uses default limit of 50 when not specified', async () => {
    // Temporarily increase max concurrent jobs for this test
    jobStore.setMaxConcurrentJobs(100);

    // Create 60 jobs
    for (let i = 0; i < 60; i++) {
      jobStore.create();
    }

    const result = await handleListJobs({});
    expect(result.jobs).toHaveLength(50);
    expect(result.total).toBe(60);

    // Reset for other tests
    jobStore.setMaxConcurrentJobs(3);
  });

  it('handles status=all explicitly', async () => {
    const job1 = jobStore.create();
    const job2 = jobStore.create();
    jobStore.updateStatus(job2, 'complete');

    const result = await handleListJobs({ status: 'all' });
    expect(result.jobs).toHaveLength(2);
  });

  it('filters by jobType build_spec_review', async () => {
    const job1 = jobStore.create('prd_refinement');
    const job2 = jobStore.create('build_spec_review');

    const result = await handleListJobs({ jobType: 'build_spec_review' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job2);
    expect(result.jobs[0].jobType).toBe('build_spec_review');
  });

  it('filters by jobType prd_refinement', async () => {
    const job1 = jobStore.create('prd_refinement');
    const job2 = jobStore.create('build_spec_review');

    const result = await handleListJobs({ jobType: 'prd_refinement' });
    expect(result.jobs).toHaveLength(1);
    expect(result.jobs[0].jobId).toBe(job1);
    expect(result.jobs[0].jobType).toBe('prd_refinement');
  });

  it('returns all jobTypes when jobType=all', async () => {
    jobStore.create('prd_refinement');
    jobStore.create('build_spec_review');

    const result = await handleListJobs({ jobType: 'all' });
    expect(result.jobs).toHaveLength(2);
  });

  it('returns jobType field in summaries', async () => {
    jobStore.create('build_spec_review');

    const result = await handleListJobs({});
    expect(result.jobs[0].jobType).toBe('build_spec_review');
  });
});
