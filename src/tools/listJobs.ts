// ============================================================================
// List Jobs Tool - Retrieve running and completed jobs (v4.0 updated)
// ============================================================================

import type { ListJobsInput, ListJobsOutput, JobSummary, JobType } from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';
import { isJobSaved } from '../utils/jobPersistence.js';

export type { ListJobsInput, ListJobsOutput, JobSummary };

export async function handleListJobs(params: ListJobsInput): Promise<ListJobsOutput> {
  const { status = 'all', jobType = 'all', limit = 50 } = params;

  let jobs = jobStore.getAll();

  // Filter by status if specified
  if (status !== 'all') {
    jobs = jobs.filter((job) => job.status === status);
  }

  // Filter by jobType if specified (F-6)
  if (jobType !== 'all') {
    jobs = jobs.filter((job) => {
      // Default to 'prd_refinement' for legacy jobs without jobType (F-6 / AD-5)
      const effectiveType: JobType = job.jobType ?? 'prd_refinement';
      return effectiveType === jobType;
    });
  }

  // Sort by lastUpdate descending (most recent first)
  jobs.sort((a, b) => new Date(b.lastUpdate).getTime() - new Date(a.lastUpdate).getTime());

  // Apply limit
  const limitedJobs = jobs.slice(0, limit);

  // Check disk save status for each job
  const savedStatuses = await Promise.all(
    limitedJobs.map((job) => isJobSaved(job.jobId).catch(() => false))
  );

  // Map to enriched summary format (F-6)
  const summaries: JobSummary[] = limitedJobs.map((job, idx) => {
    const effectiveJobType: JobType = job.jobType ?? 'prd_refinement';
    const result = job.result as any;

    return {
      jobId: job.jobId,
      jobType: effectiveJobType,
      status: job.status,
      title: job.title,
      createdAt: job.createdAt,
      lastUpdate: job.lastUpdate,
      completedAt: job.completedAt,
      currentRound: job.currentRound,
      currentModel: job.currentModel,
      totalRounds: result?.stats?.totalRounds,
      estimatedCost: result?.stats?.estimatedCost,
      consensusReached: job.consensusReached,
      savedToDisk: savedStatuses[idx],
    };
  });

  return {
    jobs: summaries,
    total: jobs.length,
  };
}
