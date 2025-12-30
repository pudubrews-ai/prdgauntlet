// ============================================================================
// List Jobs Tool - Retrieve running and completed jobs
// ============================================================================

import type { ListJobsInput, ListJobsOutput, JobSummary } from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';

export type { ListJobsInput, ListJobsOutput, JobSummary };

export function handleListJobs(params: ListJobsInput): ListJobsOutput {
  const { status = 'all', limit = 50 } = params;

  let jobs = jobStore.getAll();

  // Filter by status if specified
  if (status !== 'all') {
    jobs = jobs.filter((job) => job.status === status);
  }

  // Sort by lastUpdate descending (most recent first)
  jobs.sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime());

  // Apply limit
  const limitedJobs = jobs.slice(0, limit);

  // Map to summary format (includes full UUID)
  const summaries: JobSummary[] = limitedJobs.map((job) => ({
    jobId: job.jobId,
    status: job.status,
    createdAt: job.createdAt,
    lastUpdate: job.lastUpdate,
    currentRound: job.currentRound,
    currentModel: job.currentModel,
  }));

  return {
    jobs: summaries,
    total: jobs.length,
  };
}
