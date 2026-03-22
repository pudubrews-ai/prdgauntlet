import { describe, it, expect, beforeEach } from 'vitest';
import { handleGetTranscript } from '../../src/tools/getTranscript.js';
import { jobStore } from '../../src/utils/jobStore.js';

describe('handleGetTranscript', () => {
  beforeEach(() => {
    jobStore.clear();
  });

  it('returns JOB_NOT_FOUND for non-existent job', async () => {
    const result = await handleGetTranscript({
      jobId: '00000000-0000-0000-0000-000000000000',
      model: 'chatgpt',
    });
    expect(result).toHaveProperty('error', 'JOB_NOT_FOUND');
  });

  it('returns JOB_NOT_FOUND for invalid UUID format', async () => {
    const result = await handleGetTranscript({
      jobId: 'not-a-uuid',
      model: 'chatgpt',
    });
    expect(result).toHaveProperty('error', 'JOB_NOT_FOUND');
  });

  it('returns TRANSCRIPT_UNAVAILABLE when no transcript stored', async () => {
    const jobId = jobStore.create();
    const result = await handleGetTranscript({ jobId, model: 'chatgpt' });

    expect(result).toHaveProperty('error', 'TRANSCRIPT_UNAVAILABLE');
  });

  it('returns transcript when available', async () => {
    const jobId = jobStore.create();
    const transcript = {
      summary: {
        rounds: 2,
        outcome: 'consensus' as const,
        keyChanges: ['Added error handling'],
      },
      messages: [
        {
          role: 'critic' as const,
          content: 'Missing error handling for edge cases.',
          timestamp: '2025-01-01T00:00:00Z',
        },
        {
          role: 'defender' as const,
          content: 'Added comprehensive error handling.',
          timestamp: '2025-01-01T00:01:00Z',
        },
      ],
    };

    jobStore.storeTranscript(jobId, 'chatgpt', transcript);
    const result = await handleGetTranscript({ jobId, model: 'chatgpt' });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('transcript');
    expect((result as any).transcript.summary.rounds).toBe(2);
    expect((result as any).transcript.messages).toHaveLength(2);
  });

  it('returns CRITIC_SKIPPED when critic was skipped', async () => {
    const jobId = jobStore.create();
    jobStore.complete(jobId, {
      jobId,
      finalPrd: '# PRD',
      changelog: [],
      stats: {
        totalRounds: 2,
        tokensUsed: { claude: 1000, chatgpt: 500, gemini: 0 },
        estimatedCost: 0.03,
        skippedCritics: [{ model: 'gemini', reason: 'Provider unavailable' }],
      },
    });

    const result = await handleGetTranscript({ jobId, model: 'gemini' });

    expect(result).toHaveProperty('error', 'CRITIC_SKIPPED');
    expect((result as any).message).toContain('Provider unavailable');
  });

  it('retrieves correct transcript for specific model', async () => {
    const jobId = jobStore.create();

    const chatgptTranscript = {
      summary: { rounds: 2, outcome: 'consensus' as const, keyChanges: ['ChatGPT change'] },
      messages: [{ role: 'critic' as const, content: 'ChatGPT feedback', timestamp: '2025-01-01T00:00:00Z' }],
    };

    const geminiTranscript = {
      summary: { rounds: 3, outcome: 'consensus' as const, keyChanges: ['Gemini change'] },
      messages: [{ role: 'critic' as const, content: 'Gemini feedback', timestamp: '2025-01-01T00:01:00Z' }],
    };

    jobStore.storeTranscript(jobId, 'chatgpt', chatgptTranscript);
    jobStore.storeTranscript(jobId, 'gemini', geminiTranscript);

    const chatgptResult = await handleGetTranscript({ jobId, model: 'chatgpt' });
    const geminiResult = await handleGetTranscript({ jobId, model: 'gemini' });

    expect((chatgptResult as any).transcript.summary.keyChanges[0]).toBe('ChatGPT change');
    expect((geminiResult as any).transcript.summary.keyChanges[0]).toBe('Gemini change');
  });
});
