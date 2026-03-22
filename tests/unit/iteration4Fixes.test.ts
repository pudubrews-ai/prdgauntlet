// ============================================================================
// Iteration 4 Fix Verification Tests (D10-v2, D11-v2)
// ============================================================================

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ---------------------------------------------------------------------------
// D10-v2: Type guard for disk fallback transcript data (getTranscript.ts)
// ---------------------------------------------------------------------------

vi.mock('../../src/utils/jobPersistence.js', () => ({
  loadJobFromDisk: vi.fn(),
  saveJobToDisk: vi.fn(),
  ensureJobsDir: vi.fn(),
  getJobsDir: vi.fn().mockReturnValue('/tmp/gauntlet-mock-jobs'),
  listSavedJobs: vi.fn(),
  deleteJob: vi.fn(),
  isJobSaved: vi.fn(),
}));

import { handleGetTranscript } from '../../src/tools/getTranscript.js';
import { jobStore } from '../../src/utils/jobStore.js';
import { loadJobFromDisk } from '../../src/utils/jobPersistence.js';

const mockLoadJobFromDisk = vi.mocked(loadJobFromDisk);

// Valid UUIDs v4 (third segment starts with 4)
const UUID1 = 'a1b2c3d4-e5f6-4a7b-8c9d-e0f1a2b3c4d5';
const UUID2 = 'b1b2c3d4-e5f6-4b7b-8c9d-e0f1a2b3c4d5';
const UUID3 = 'c1b2c3d4-e5f6-4c7b-8c9d-e0f1a2b3c4d5';
const UUID4 = 'd1b2c3d4-e5f6-4d7b-8c9d-e0f1a2b3c4d5';
const UUID5 = 'e1b2c3d4-e5f6-4e7b-8c9d-e0f1a2b3c4d5';

describe('D10-v2: Type guard for disk fallback transcript data', () => {
  beforeEach(() => {
    jobStore.clear();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('returns TRANSCRIPT_UNAVAILABLE when summary is a non-object (corrupted)', async () => {
    mockLoadJobFromDisk.mockResolvedValue({
      debates: { chatgpt: { summary: 42, messages: [] } },
    } as any);

    const result = await handleGetTranscript({
      jobId: UUID1,
      model: 'chatgpt',
    });

    expect(result).toHaveProperty('error', 'TRANSCRIPT_UNAVAILABLE');
    expect((result as any).message).toMatch(/corrupted/i);
  });

  it('returns TRANSCRIPT_UNAVAILABLE when messages is a string (corrupted)', async () => {
    mockLoadJobFromDisk.mockResolvedValue({
      debates: {
        chatgpt: { summary: { rounds: 1, outcome: 'consensus', keyChanges: [] }, messages: 'not-an-array' },
      },
    } as any);

    const result = await handleGetTranscript({
      jobId: UUID2,
      model: 'chatgpt',
    });

    expect(result).toHaveProperty('error', 'TRANSCRIPT_UNAVAILABLE');
    expect((result as any).message).toMatch(/corrupted/i);
  });

  it('returns valid transcript when disk data is well-formed', async () => {
    mockLoadJobFromDisk.mockResolvedValue({
      debates: {
        chatgpt: {
          summary: { rounds: 2, outcome: 'consensus', keyChanges: [] },
          messages: [{ role: 'critic', content: 'test', timestamp: '2026-01-01T00:00:00Z' }],
        },
      },
    } as any);

    const result = await handleGetTranscript({
      jobId: UUID3,
      model: 'chatgpt',
    });

    expect(result).not.toHaveProperty('error');
    expect(result).toHaveProperty('transcript');
    expect((result as any).transcript.summary.rounds).toBe(2);
    expect((result as any).transcript.messages).toHaveLength(1);
  });

  it('returns TRANSCRIPT_UNAVAILABLE when debate entry is a primitive (not an object)', async () => {
    mockLoadJobFromDisk.mockResolvedValue({
      debates: { chatgpt: 'not-an-object' },
    } as any);

    const result = await handleGetTranscript({
      jobId: UUID4,
      model: 'chatgpt',
    });

    expect(result).toHaveProperty('error', 'TRANSCRIPT_UNAVAILABLE');
    expect((result as any).message).toMatch(/corrupted/i);
  });

  it('returns TRANSCRIPT_UNAVAILABLE with "No transcript found" when model key is absent (regression)', async () => {
    mockLoadJobFromDisk.mockResolvedValue({
      debates: {
        gemini: { summary: { rounds: 1, outcome: 'consensus', keyChanges: [] }, messages: [] },
      },
    } as any);

    const result = await handleGetTranscript({
      jobId: UUID5,
      model: 'chatgpt',
    });

    expect(result).toHaveProperty('error', 'TRANSCRIPT_UNAVAILABLE');
    expect((result as any).message).toMatch(/No transcript found for model/);
  });
});

// ---------------------------------------------------------------------------
// D11-v2: Legacy stats-to-summary synthesis (jobPersistence.ts)
// ---------------------------------------------------------------------------

import * as fsModule from 'fs';
import * as os from 'os';
import * as path from 'path';

describe('D11-v2: Legacy stats-to-summary chatgptRounds/geminiRounds/totalTokens', () => {
  let tmpDir: string;
  // UUID v4 values for D11 tests
  const D11_UUID1 = 'f1b2c3d4-e5f6-4f7b-8c9d-e0f1a2b3c4d5';
  const D11_UUID2 = '01b2c3d4-e5f6-4f7b-9c9d-e0f1a2b3c4d5';
  const D11_UUID3 = '02b2c3d4-e5f6-4f7b-9c9d-e0f1a2b3c4d5';
  const D11_UUID4 = '03b2c3d4-e5f6-4f7b-9c9d-e0f1a2b3c4d5';

  beforeEach(async () => {
    tmpDir = await fsModule.promises.mkdtemp(path.join(os.tmpdir(), 'gauntlet-d11-'));
    process.env.GAUNTLET_JOBS_DIR = tmpDir;
  });

  afterEach(async () => {
    delete process.env.GAUNTLET_JOBS_DIR;
    await fsModule.promises.rm(tmpDir, { recursive: true, force: true });
  });

  async function writeLegacyJob(jobId: string, data: object) {
    const filePath = path.join(tmpDir, `${jobId}.json`);
    await fsModule.promises.writeFile(filePath, JSON.stringify(data), 'utf-8');
  }

  it('synthesizes chatgptRounds and geminiRounds from totalRounds when not present', async () => {
    await writeLegacyJob(D11_UUID1, {
      jobType: 'prd_refinement',
      stats: { totalRounds: 3, estimatedCost: 0.05, tokensUsed: { claude: 100, chatgpt: 200, gemini: 150 } },
    });

    // Import the real (non-mocked) loadJobFromDisk using dynamic import with cache-bust
    // Since the module is mocked at the top level, use the mock's underlying implementation
    // Instead, directly test the logic by calling the mocked module with env var set
    // We need the real implementation — use vi.importActual
    const real = await vi.importActual<typeof import('../../src/utils/jobPersistence.js')>(
      '../../src/utils/jobPersistence.js'
    );
    const result = await real.loadJobFromDisk(D11_UUID1);

    expect((result as any).summary).toBeDefined();
    expect((result as any).summary.chatgptRounds).toBe(3);
    expect((result as any).summary.geminiRounds).toBe(3);
  });

  it('uses explicit chatgptRounds/geminiRounds from stats when present', async () => {
    await writeLegacyJob(D11_UUID2, {
      jobType: 'prd_refinement',
      stats: { totalRounds: 5, chatgptRounds: 2, geminiRounds: 3, estimatedCost: 0.1, tokensUsed: 1000 },
    });

    const real = await vi.importActual<typeof import('../../src/utils/jobPersistence.js')>(
      '../../src/utils/jobPersistence.js'
    );
    const result = await real.loadJobFromDisk(D11_UUID2);

    expect((result as any).summary.chatgptRounds).toBe(2);
    expect((result as any).summary.geminiRounds).toBe(3);
  });

  it('handles totalTokens when tokensUsed is a plain number', async () => {
    await writeLegacyJob(D11_UUID3, {
      jobType: 'prd_refinement',
      stats: { totalRounds: 2, estimatedCost: 0.02, tokensUsed: 500 },
    });

    const real = await vi.importActual<typeof import('../../src/utils/jobPersistence.js')>(
      '../../src/utils/jobPersistence.js'
    );
    const result = await real.loadJobFromDisk(D11_UUID3);

    expect((result as any).summary.totalTokens).toBe(500);
  });

  it('handles totalTokens when tokensUsed has a .total field', async () => {
    await writeLegacyJob(D11_UUID4, {
      jobType: 'prd_refinement',
      stats: { totalRounds: 2, estimatedCost: 0.02, tokensUsed: { total: 900 } },
    });

    const real = await vi.importActual<typeof import('../../src/utils/jobPersistence.js')>(
      '../../src/utils/jobPersistence.js'
    );
    const result = await real.loadJobFromDisk(D11_UUID4);

    expect((result as any).summary.totalTokens).toBe(900);
  });
});
