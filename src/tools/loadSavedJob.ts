// ============================================================================
// load_saved_job Tool - Load completed job from disk
// ============================================================================

import { z } from 'zod';
import type { GauntletConfig, GauntletOutput } from '../types/index.js';
import { loadJobFromDisk } from '../utils/jobPersistence.js';
import { logger } from '../utils/logger.js';

// Input schema
export const LoadSavedJobInputSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
});

export type LoadSavedJobInput = z.infer<typeof LoadSavedJobInputSchema>;

export interface LoadSavedJobError {
  error: string;
  message: string;
}

export async function handleLoadSavedJob(
  input: unknown,
  config: GauntletConfig
): Promise<GauntletOutput | LoadSavedJobError> {
  // Validate input
  const parseResult = LoadSavedJobInputSchema.safeParse(input);
  if (!parseResult.success) {
    const issues = parseResult.error.issues;
    return {
      error: 'INVALID_INPUT',
      message: issues.map((e) => e.message).join('; '),
    };
  }

  const { jobId } = parseResult.data;

  // Load from disk
  try {
    const output = await loadJobFromDisk(jobId);

    if (!output) {
      return {
        error: 'JOB_NOT_FOUND',
        message: `Job ${jobId} not found on disk. It may not have been saved or was deleted.`,
      };
    }

    logger.logInfo('Job loaded from disk', { jobId });

    return output;
  } catch (error) {
    logger.logError('Failed to load job', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      error: 'LOAD_FAILED',
      message: `Failed to load job: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
