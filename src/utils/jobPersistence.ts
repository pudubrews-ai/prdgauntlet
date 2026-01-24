// ============================================================================
// Job Persistence - Save/load completed jobs to disk
// ============================================================================

import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import type { GauntletOutput } from '../types/index.js';
import { logger } from './logger.js';

// Default jobs directory: ~/.gauntlet/jobs/
const DEFAULT_JOBS_DIR = path.join(homedir(), '.gauntlet', 'jobs');

/**
 * Get jobs directory (supports env var override)
 */
export function getJobsDir(): string {
  return process.env.GAUNTLET_JOBS_DIR || DEFAULT_JOBS_DIR;
}

/**
 * Ensure jobs directory exists
 */
export async function ensureJobsDir(): Promise<void> {
  const jobsDir = getJobsDir();
  try {
    await fs.mkdir(jobsDir, { recursive: true });
  } catch (error) {
    logger.logError('Failed to create jobs directory', {
      path: jobsDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Save job output to disk
 */
export async function saveJobToDisk(
  jobId: string,
  output: GauntletOutput
): Promise<string> {
  await ensureJobsDir();

  const jobsDir = getJobsDir();
  const filePath = path.join(jobsDir, `${jobId}.json`);

  try {
    const data = JSON.stringify(output, null, 2);
    await fs.writeFile(filePath, data, 'utf-8');
    logger.logDebug('Job saved to disk', { jobId, path: filePath });
    return filePath;
  } catch (error) {
    logger.logError('Failed to save job to disk', {
      jobId,
      path: filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Load job output from disk
 */
export async function loadJobFromDisk(
  jobId: string
): Promise<GauntletOutput | null> {
  const jobsDir = getJobsDir();
  const filePath = path.join(jobsDir, `${jobId}.json`);

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    const output = JSON.parse(data) as GauntletOutput;
    logger.logDebug('Job loaded from disk', { jobId, path: filePath });
    return output;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.logDebug('Job not found on disk', { jobId, path: filePath });
      return null;
    }

    logger.logError('Failed to load job from disk', {
      jobId,
      path: filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * List all saved jobs
 */
export async function listSavedJobs(): Promise<
  Array<{
    jobId: string;
    savedAt: string;
    rounds?: number;
    cost?: number;
  }>
> {
  const jobsDir = getJobsDir();

  try {
    // Ensure directory exists
    await ensureJobsDir();

    const files = await fs.readdir(jobsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json'));

    const jobs = await Promise.all(
      jsonFiles.map(async (file) => {
        const jobId = file.replace('.json', '');
        const filePath = path.join(jobsDir, file);

        try {
          const stats = await fs.stat(filePath);
          const data = await fs.readFile(filePath, 'utf-8');
          const output = JSON.parse(data) as GauntletOutput;

          return {
            jobId,
            savedAt: stats.mtime.toISOString(),
            rounds: output.stats.totalRounds,
            cost: output.stats.estimatedCost,
          };
        } catch (error) {
          logger.logWarn('Failed to read job metadata', {
            jobId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // Return minimal info if we can't parse the file
          const stats = await fs.stat(filePath);
          return {
            jobId,
            savedAt: stats.mtime.toISOString(),
          };
        }
      })
    );

    // Sort by savedAt descending (most recent first)
    jobs.sort(
      (a, b) =>
        new Date(b.savedAt).getTime() - new Date(a.savedAt).getTime()
    );

    return jobs;
  } catch (error) {
    logger.logError('Failed to list saved jobs', {
      path: jobsDir,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Delete a saved job
 */
export async function deleteJob(jobId: string): Promise<void> {
  const jobsDir = getJobsDir();
  const filePath = path.join(jobsDir, `${jobId}.json`);

  try {
    await fs.unlink(filePath);
    logger.logDebug('Job deleted from disk', { jobId, path: filePath });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.logDebug('Job file not found, already deleted', {
        jobId,
        path: filePath,
      });
      return;
    }

    logger.logError('Failed to delete job', {
      jobId,
      path: filePath,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Check if a job is saved on disk
 */
export async function isJobSaved(jobId: string): Promise<boolean> {
  const jobsDir = getJobsDir();
  const filePath = path.join(jobsDir, `${jobId}.json`);

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
