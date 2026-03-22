// ============================================================================
// check_gauntlet_status Tool - Retrieve job status and partial results (FR2)
// ============================================================================

import { z } from 'zod';
import type { StatusOutput, StatusError } from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';

// Input schema
export const StatusInputSchema = z.object({
  jobId: z.string().uuid(),
});

export type StatusInput = z.infer<typeof StatusInputSchema>;

export function handleCheckStatus(
  input: unknown
): StatusOutput | StatusError {
  // Validate input
  const parseResult = StatusInputSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      error: 'JOB_NOT_FOUND',
      message: `Invalid job ID format: ${parseResult.error.message}`,
    };
  }

  const { jobId } = parseResult.data;

  // Look up job
  const job = jobStore.get(jobId);
  if (!job) {
    return {
      error: 'JOB_NOT_FOUND',
      message: 'Job ID not found. Jobs are ephemeral and lost on server restart.',
    };
  }

  // Build response based on status
  const response: StatusOutput = {
    jobId: job.jobId,
    status: job.status,
    lastUpdate: job.lastUpdate,
  };

  // Include progress info if actively debating
  if (job.status === 'debating_chatgpt' || job.status === 'debating_gemini') {
    response.currentRound = job.currentRound;
    response.currentModel = job.currentModel;

    if (job.partialResult) {
      response.partialResult = {
        currentPrd: job.partialResult.currentPrd,
        changelogSoFar: job.partialResult.changelogSoFar,
      };
    }
  }

  // If complete, include the full result
  if (job.status === 'complete' && job.result) {
    // Return the final result directly - this is the key retrieval case
    return {
      jobId: job.jobId,
      status: job.status,
      lastUpdate: job.lastUpdate,
      // Include finalPrd in partialResult for completed jobs (allows retrieval)
      partialResult: {
        currentPrd: (job.result as any).finalPrd ?? '',
        changelogSoFar: job.result.changelog,
      },
    };
  }

  // If error, include error info
  if (job.status === 'error' && job.error) {
    return {
      jobId: job.jobId,
      status: job.status,
      lastUpdate: job.lastUpdate,
    };
  }

  return response;
}
