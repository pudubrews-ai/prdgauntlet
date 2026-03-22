// ============================================================================
// save_job_output Tool - Manually save completed job to disk
// ============================================================================

import { z } from 'zod';
import type { GauntletConfig } from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';
import { saveJobToDisk } from '../utils/jobPersistence.js';
import { logger } from '../utils/logger.js';

// Input schema
export const SaveJobOutputInputSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
});

export type SaveJobOutputInput = z.infer<typeof SaveJobOutputInputSchema>;

export interface SaveJobOutputResult {
  success: boolean;
  message: string;
  filePath?: string;
}

export interface SaveJobOutputError {
  error: string;
  message: string;
}

export async function handleSaveJobOutput(
  input: unknown,
  config: GauntletConfig
): Promise<SaveJobOutputResult | SaveJobOutputError> {
  // Validate input
  const parseResult = SaveJobOutputInputSchema.safeParse(input);
  if (!parseResult.success) {
    const issues = parseResult.error.issues;
    return {
      error: 'INVALID_INPUT',
      message: issues.map((e) => e.message).join('; '),
    };
  }

  const { jobId } = parseResult.data;

  // Get job from store
  const job = jobStore.get(jobId);
  if (!job) {
    return {
      error: 'JOB_NOT_FOUND',
      message: 'Job ID not found. Jobs are ephemeral and lost on server restart.',
    };
  }

  // Check if job is complete
  if (job.status !== 'complete' && job.status !== 'error') {
    return {
      error: 'JOB_NOT_COMPLETE',
      message: `Job is still ${job.status}. Only completed or errored jobs can be saved.`,
    };
  }

  // Get the output
  if (!job.result) {
    return {
      error: 'NO_RESULT',
      message: 'Job has no result to save.',
    };
  }

  // Save to disk
  try {
    const filePath = await saveJobToDisk(jobId, job.result as any);

    logger.logInfo('Job manually saved to disk', { jobId, filePath });

    return {
      success: true,
      message: `Job saved successfully to ${filePath}`,
      filePath,
    };
  } catch (error) {
    logger.logError('Failed to save job', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      error: 'SAVE_FAILED',
      message: `Failed to save job: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
