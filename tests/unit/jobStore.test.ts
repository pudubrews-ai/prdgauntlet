import { describe, it, expect, beforeEach } from 'vitest';
import { JobStore } from '../../src/utils/jobStore.js';

describe('JobStore', () => {
  let store: JobStore;

  beforeEach(() => {
    store = new JobStore(3);
  });

  describe('create', () => {
    it('should create job with UUIDv4 format', () => {
      const jobId = store.create();
      expect(jobId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should initialize job with idle status', () => {
      const jobId = store.create();
      const job = store.get(jobId);

      expect(job).toBeDefined();
      expect(job?.status).toBe('idle');
      expect(job?.createdAt).toBeDefined();
      expect(job?.lastUpdate).toBeDefined();
    });

    it('should enforce concurrent job limit', () => {
      store.create();
      store.create();
      store.create();

      expect(() => store.create()).toThrow('Maximum concurrent jobs (3) reached');
    });

    it('should allow new job after completing one', () => {
      const job1 = store.create();
      store.create();
      store.create();

      store.complete(job1, {
        jobId: job1,
        finalPrd: 'test',
        changelog: [],
        stats: {
          totalRounds: 0,
          tokensUsed: { claude: 0, chatgpt: 0, gemini: 0 },
          estimatedCost: 0,
        },
      });

      expect(() => store.create()).not.toThrow();
    });
  });

  describe('get/exists', () => {
    it('should return job by ID', () => {
      const jobId = store.create();
      const job = store.get(jobId);

      expect(job?.jobId).toBe(jobId);
    });

    it('should return undefined for non-existent job', () => {
      expect(store.get('non-existent-id')).toBeUndefined();
    });

    it('should check job existence', () => {
      const jobId = store.create();

      expect(store.exists(jobId)).toBe(true);
      expect(store.exists('non-existent')).toBe(false);
    });
  });

  describe('updateStatus', () => {
    it('should update job status', () => {
      const jobId = store.create();
      store.updateStatus(jobId, 'debating_chatgpt');

      const job = store.get(jobId);
      expect(job?.status).toBe('debating_chatgpt');
    });

    it('should update lastUpdate timestamp', async () => {
      const jobId = store.create();
      const originalUpdate = store.get(jobId)?.lastUpdate;

      // Small delay to ensure different timestamp
      await new Promise((resolve) => setTimeout(resolve, 10));
      store.updateStatus(jobId, 'debating_chatgpt');

      expect(store.get(jobId)?.lastUpdate).not.toBe(originalUpdate);
    });

    it('should throw for non-existent job', () => {
      expect(() => store.updateStatus('bad-id', 'complete')).toThrow(
        'Job not found: bad-id'
      );
    });

    it('should clear round info when status is complete/error', () => {
      const jobId = store.create();
      store.updateDebateProgress(jobId, 'chatgpt', 3, 'prd', []);

      store.updateStatus(jobId, 'complete');

      const job = store.get(jobId);
      expect(job?.currentRound).toBeUndefined();
      expect(job?.currentModel).toBeUndefined();
    });
  });

  describe('updateDebateProgress', () => {
    it('should update debate progress', () => {
      const jobId = store.create();
      const changelog = [
        {
          version: 1,
          source: 'chatgpt' as const,
          round: 1,
          type: 'modification' as const,
          summary: 'Test',
        },
      ];

      store.updateDebateProgress(jobId, 'chatgpt', 2, 'Updated PRD', changelog);

      const job = store.get(jobId);
      expect(job?.status).toBe('debating_chatgpt');
      expect(job?.currentModel).toBe('chatgpt');
      expect(job?.currentRound).toBe(2);
      expect(job?.partialResult?.currentPrd).toBe('Updated PRD');
      expect(job?.partialResult?.changelogSoFar).toHaveLength(1);
    });
  });

  describe('storeTranscript', () => {
    it('should store transcript for model', () => {
      const jobId = store.create();
      const transcript = {
        summary: {
          rounds: 3,
          outcome: 'consensus' as const,
          keyChanges: ['Change 1'],
        },
        messages: [],
      };

      store.storeTranscript(jobId, 'chatgpt', transcript);

      const job = store.get(jobId);
      expect(job?.transcripts?.chatgpt).toEqual(transcript);
    });
  });

  describe('complete', () => {
    it('should mark job as complete with result', () => {
      const jobId = store.create();
      const result = {
        jobId,
        finalPrd: 'Final PRD',
        changelog: [],
        stats: {
          totalRounds: 5,
          tokensUsed: { claude: 1000, chatgpt: 500, gemini: 500 },
          estimatedCost: 0.5,
        },
      };

      store.complete(jobId, result);

      const job = store.get(jobId);
      expect(job?.status).toBe('complete');
      expect(job?.result).toEqual(result);
      expect(job?.partialResult).toBeUndefined();
    });
  });

  describe('fail', () => {
    it('should mark job as error with error info', () => {
      const jobId = store.create();
      const error = {
        error: 'PROVIDER_ERROR' as const,
        message: 'API failed',
      };

      store.fail(jobId, error);

      const job = store.get(jobId);
      expect(job?.status).toBe('error');
      expect(job?.error).toEqual(error);
    });
  });

  describe('delete', () => {
    it('should remove job from store', () => {
      const jobId = store.create();
      expect(store.exists(jobId)).toBe(true);

      const deleted = store.delete(jobId);

      expect(deleted).toBe(true);
      expect(store.exists(jobId)).toBe(false);
    });

    it('should return false for non-existent job', () => {
      expect(store.delete('non-existent')).toBe(false);
    });
  });

  describe('getActiveCount', () => {
    it('should count active jobs', () => {
      expect(store.getActiveCount()).toBe(0);

      const job1 = store.create();
      expect(store.getActiveCount()).toBe(1);

      store.create();
      expect(store.getActiveCount()).toBe(2);

      store.complete(job1, {
        jobId: job1,
        finalPrd: '',
        changelog: [],
        stats: {
          totalRounds: 0,
          tokensUsed: { claude: 0, chatgpt: 0, gemini: 0 },
          estimatedCost: 0,
        },
      });
      expect(store.getActiveCount()).toBe(1);
    });

    it('should not count completed or errored jobs', () => {
      const job1 = store.create();
      const job2 = store.create();

      store.complete(job1, {
        jobId: job1,
        finalPrd: '',
        changelog: [],
        stats: {
          totalRounds: 0,
          tokensUsed: { claude: 0, chatgpt: 0, gemini: 0 },
          estimatedCost: 0,
        },
      });
      store.fail(job2, { error: 'PROVIDER_ERROR', message: 'Failed' });

      expect(store.getActiveCount()).toBe(0);
    });
  });

  describe('getTranscript', () => {
    it('should retrieve stored transcript', () => {
      const jobId = store.create();
      const transcript = {
        summary: {
          rounds: 2,
          outcome: 'consensus' as const,
          keyChanges: [],
        },
        messages: [],
      };

      store.storeTranscript(jobId, 'gemini', transcript);

      expect(store.getTranscript(jobId, 'gemini')).toEqual(transcript);
      expect(store.getTranscript(jobId, 'chatgpt')).toBeUndefined();
    });
  });

  describe('cleanup', () => {
    it('should remove old completed jobs', () => {
      const jobId = store.create();
      store.complete(jobId, {
        jobId,
        finalPrd: '',
        changelog: [],
        stats: {
          totalRounds: 0,
          tokensUsed: { claude: 0, chatgpt: 0, gemini: 0 },
          estimatedCost: 0,
        },
      });

      // Should not remove (not old enough)
      const removed = store.cleanup(60000);
      expect(removed).toBe(0);
      expect(store.exists(jobId)).toBe(true);
    });
  });

  describe('clear', () => {
    it('should remove all jobs', () => {
      store.create();
      store.create();

      store.clear();

      expect(store.getAll()).toHaveLength(0);
    });
  });

  describe('setMaxConcurrentJobs', () => {
    it('should update concurrent job limit', () => {
      store.setMaxConcurrentJobs(1);

      store.create();
      expect(() => store.create()).toThrow('Maximum concurrent jobs (1)');
    });
  });
});
