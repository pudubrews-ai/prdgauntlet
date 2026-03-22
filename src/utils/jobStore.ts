// ============================================================================
// Job Store - In-memory ephemeral job management (FR11)
// ============================================================================

import { v4 as uuidv4 } from 'uuid';
import type {
  JobState,
  JobStatus,
  JobType,
  CriticModel,
  ChangeEntry,
  DebateTranscript,
  GauntletOutput,
  BuildSpecReviewOutput,
  GauntletError,
} from '../types/index.js';

export class JobStore {
  private jobs: Map<string, JobState> = new Map();
  private maxConcurrentJobs: number;

  constructor(maxConcurrentJobs = 3) {
    this.maxConcurrentJobs = maxConcurrentJobs;
  }

  setMaxConcurrentJobs(max: number): void {
    this.maxConcurrentJobs = max;
  }

  create(jobType: JobType = 'prd_refinement'): string {
    const activeCount = this.getActiveCount();
    if (activeCount >= this.maxConcurrentJobs) {
      throw new Error(
        `Maximum concurrent jobs (${this.maxConcurrentJobs}) reached. ` +
          `${activeCount} jobs currently active.`
      );
    }

    const jobId = uuidv4();
    const now = new Date().toISOString();

    const job: JobState = {
      jobId,
      jobType,
      status: 'idle',
      createdAt: now,
      lastUpdate: now,
    };

    this.jobs.set(jobId, job);
    return jobId;
  }

  get(jobId: string): JobState | undefined {
    return this.jobs.get(jobId);
  }

  exists(jobId: string): boolean {
    return this.jobs.has(jobId);
  }

  updateStatus(jobId: string, status: JobStatus): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    job.status = status;
    job.lastUpdate = new Date().toISOString();

    // Clear round info when not in debate
    if (status === 'complete' || status === 'error' || status === 'idle' || status === 'incomplete_output' || status === 'consensus_failed') {
      job.currentRound = undefined;
      job.currentModel = undefined;
    }
  }

  updateDebateProgress(
    jobId: string,
    model: CriticModel,
    round: number,
    currentPrd: string,
    changelogSoFar: ChangeEntry[]
  ): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    job.status = model === 'chatgpt' ? 'debating_chatgpt' : 'debating_gemini';
    job.currentModel = model;
    job.currentRound = round;
    job.lastUpdate = new Date().toISOString();
    job.partialResult = {
      currentPrd,
      changelogSoFar: [...changelogSoFar],
    };
  }

  storeTranscript(jobId: string, model: CriticModel, transcript: DebateTranscript): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    if (!job.transcripts) {
      job.transcripts = {};
    }

    job.transcripts[model] = transcript;
    job.lastUpdate = new Date().toISOString();
  }

  complete(jobId: string, result: GauntletOutput | BuildSpecReviewOutput, status: JobStatus = 'complete'): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    // v4.0: Support custom status (e.g., 'incomplete_output', 'consensus_failed')
    job.status = status;
    job.result = result;
    job.lastUpdate = new Date().toISOString();
    job.currentRound = undefined;
    job.currentModel = undefined;
    job.partialResult = undefined;
  }

  fail(jobId: string, error: GauntletError): void {
    const job = this.jobs.get(jobId);
    if (!job) {
      throw new Error(`Job not found: ${jobId}`);
    }

    job.status = 'error';
    job.error = error;
    job.lastUpdate = new Date().toISOString();
    job.currentRound = undefined;
    job.currentModel = undefined;
  }

  delete(jobId: string): boolean {
    return this.jobs.delete(jobId);
  }

  getActiveCount(): number {
    let count = 0;
    for (const job of this.jobs.values()) {
      if (
        job.status === 'idle' ||
        job.status === 'debating_chatgpt' ||
        job.status === 'debating_gemini'
      ) {
        count++;
      }
    }
    return count;
  }

  getAll(): JobState[] {
    return Array.from(this.jobs.values());
  }

  getTranscript(jobId: string, model: CriticModel): DebateTranscript | undefined {
    const job = this.jobs.get(jobId);
    return job?.transcripts?.[model];
  }

  // Cleanup completed/errored jobs older than the given age (in milliseconds)
  cleanup(maxAge: number = 30 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;

    for (const [jobId, job] of this.jobs.entries()) {
      if (job.status === 'complete' || job.status === 'error' || job.status === 'incomplete_output' || job.status === 'consensus_failed') {
        const lastUpdate = new Date(job.lastUpdate).getTime();
        if (now - lastUpdate > maxAge) {
          this.jobs.delete(jobId);
          removed++;
        }
      }
    }

    return removed;
  }

  clear(): void {
    this.jobs.clear();
  }
}

// Singleton instance
export const jobStore = new JobStore();
