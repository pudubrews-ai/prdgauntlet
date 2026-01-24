// ============================================================================
// list_saved_jobs Tool - List all saved jobs on disk
// ============================================================================

import { z } from 'zod';
import type { GauntletConfig } from '../types/index.js';
import { listSavedJobs } from '../utils/jobPersistence.js';
import { logger } from '../utils/logger.js';

// Input schema (no params needed)
export const ListSavedJobsInputSchema = z.object({});

export type ListSavedJobsInput = z.infer<typeof ListSavedJobsInputSchema>;

export interface ListSavedJobsResult {
  jobs: Array<{
    jobId: string;
    savedAt: string;
    rounds?: number;
    cost?: number;
  }>;
  count: number;
}

export interface ListSavedJobsError {
  error: string;
  message: string;
}

export async function handleListSavedJobs(
  input: unknown,
  config: GauntletConfig
): Promise<ListSavedJobsResult | ListSavedJobsError> {
  // Validate input (no required params)
  const parseResult = ListSavedJobsInputSchema.safeParse(input);
  if (!parseResult.success) {
    const issues = parseResult.error.issues;
    return {
      error: 'INVALID_INPUT',
      message: issues.map((e) => e.message).join('; '),
    };
  }

  // List all saved jobs
  try {
    const jobs = await listSavedJobs();

    logger.logInfo('Listed saved jobs', { count: jobs.length });

    return {
      jobs,
      count: jobs.length,
    };
  } catch (error) {
    logger.logError('Failed to list saved jobs', {
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      error: 'LIST_FAILED',
      message: `Failed to list saved jobs: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
