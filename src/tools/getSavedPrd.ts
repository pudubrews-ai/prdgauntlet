// ============================================================================
// get_saved_prd Tool - Extract final PRD from saved job
// ============================================================================

import { z } from 'zod';
import { promises as fs } from 'fs';
import type { GauntletConfig } from '../types/index.js';
import { loadJobFromDisk } from '../utils/jobPersistence.js';
import { logger } from '../utils/logger.js';

// Input schema
export const GetSavedPrdInputSchema = z.object({
  jobId: z.string().min(1, 'Job ID is required'),
  outputFile: z.string().optional(),
});

export type GetSavedPrdInput = z.infer<typeof GetSavedPrdInputSchema>;

export interface GetSavedPrdResult {
  jobId: string;
  finalPrd: string;
  savedToFile?: string;
  metadata?: {
    rounds: number;
    cost: number;
    changeCount: number;
  };
}

export interface GetSavedPrdError {
  error: string;
  message: string;
}

export async function handleGetSavedPrd(
  input: unknown,
  config: GauntletConfig
): Promise<GetSavedPrdResult | GetSavedPrdError> {
  // Validate input
  const parseResult = GetSavedPrdInputSchema.safeParse(input);
  if (!parseResult.success) {
    const issues = parseResult.error.issues;
    return {
      error: 'INVALID_INPUT',
      message: issues.map((e) => e.message).join('; '),
    };
  }

  const { jobId, outputFile } = parseResult.data;

  // Load from disk
  try {
    const output = await loadJobFromDisk(jobId);

    if (!output) {
      return {
        error: 'JOB_NOT_FOUND',
        message: `Job ${jobId} not found on disk. It may not have been saved or was deleted.`,
      };
    }

    const finalPrd = output.finalPrd;

    // Save to file if requested
    if (outputFile) {
      try {
        await fs.writeFile(outputFile, finalPrd, 'utf-8');
        logger.logInfo('PRD saved to file', { jobId, outputFile });
      } catch (error) {
        logger.logError('Failed to save PRD to file', {
          jobId,
          outputFile,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return {
          error: 'FILE_WRITE_FAILED',
          message: `Failed to write PRD to ${outputFile}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        };
      }
    }

    logger.logInfo('PRD extracted from saved job', { jobId });

    return {
      jobId,
      finalPrd,
      ...(outputFile && { savedToFile: outputFile }),
      metadata: {
        rounds: output.stats.totalRounds,
        cost: output.stats.estimatedCost,
        changeCount: output.changelog.length,
      },
    };
  } catch (error) {
    logger.logError('Failed to get saved PRD', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      error: 'LOAD_FAILED',
      message: `Failed to load job: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}
