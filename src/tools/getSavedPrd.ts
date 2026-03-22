// ============================================================================
// get_saved_prd Tool - Extract final PRD or spec review output from saved job
// ============================================================================

import { z } from 'zod';
import { promises as fs } from 'fs';
import path from 'path';
import type { GauntletConfig } from '../types/index.js';
import { loadJobFromDisk, getJobsDir } from '../utils/jobPersistence.js';
import { logger } from '../utils/logger.js';

// Input schema - S-5: jobId must be UUID
export const GetSavedPrdInputSchema = z.object({
  jobId: z.string().uuid('Job ID must be a valid UUID'),
  outputFile: z.string().optional(),
});

export type GetSavedPrdInput = z.infer<typeof GetSavedPrdInputSchema>;

export interface GetSavedPrdResult {
  jobId: string;
  jobType: string;
  refinedPrd?: string;
  refinedAppSpecSection?: string;
  refinedTestSpec?: string;
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

  // S-4: Sandbox outputFile to GAUNTLET_SAVE_DIR
  if (outputFile) {
    const allowedDir = path.resolve(getJobsDir());
    const resolvedOutput = path.resolve(outputFile);
    if (
      !resolvedOutput.startsWith(allowedDir + path.sep) &&
      resolvedOutput !== allowedDir
    ) {
      return {
        error: 'INVALID_PATH',
        message: 'outputFile must be within the gauntlet save directory.',
      };
    }
  }

  // Load from disk
  try {
    const output = await loadJobFromDisk(jobId);

    if (!output) {
      return {
        error: 'JOB_NOT_FOUND',
        message: 'Job not found on disk. It may not have been saved or was deleted.',
      };
    }

    // F-7: Determine jobType and return appropriate fields
    const jobType = (output as any).jobType || 'prd_refinement';

    if (jobType === 'build_spec_review') {
      const specOutput = output as any;
      return {
        jobId,
        jobType: 'build_spec_review',
        refinedAppSpecSection: specOutput.refinedAppSpecSection,
        refinedTestSpec: specOutput.refinedTestSpec,
        metadata: {
          rounds: output.stats?.totalRounds ?? 0,
          cost: output.stats?.estimatedCost ?? 0,
          changeCount: output.changelog?.length ?? 0,
        },
      };
    }

    // Default: prd_refinement
    const finalPrd = output.finalPrd;

    // Save to file if requested
    if (outputFile) {
      try {
        await fs.writeFile(outputFile, finalPrd, 'utf-8');
        logger.logInfo('PRD saved to file', { jobId });
      } catch (error) {
        logger.logError('Failed to save PRD to file', {
          jobId,
          error: error instanceof Error ? error.message : 'Unknown error',
        });
        return {
          error: 'FILE_WRITE_FAILED',
          message: 'Failed to write PRD to the specified file.',
        };
      }
    }

    logger.logInfo('PRD extracted from saved job', { jobId });

    return {
      jobId,
      jobType: 'prd_refinement',
      refinedPrd: finalPrd,
      ...(outputFile && { savedToFile: outputFile }),
      metadata: {
        rounds: output.stats?.totalRounds ?? output.summary?.totalRounds ?? 0,
        cost: output.stats?.estimatedCost ?? output.summary?.estimatedCost ?? 0,
        changeCount: output.changelog?.length ?? 0,
      },
    };
  } catch (error) {
    logger.logError('Failed to get saved PRD', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });

    return {
      error: 'LOAD_FAILED',
      message: 'Failed to load the requested job.',
    };
  }
}
