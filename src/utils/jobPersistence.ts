// ============================================================================
// Job Persistence - Save/load completed jobs to disk
// ============================================================================

import { promises as fs } from 'fs';
import { homedir } from 'os';
import path from 'path';
import type { GauntletOutput, JobType } from '../types/index.js';
import { logger } from './logger.js';

// Default jobs directory: ~/.gauntlet/jobs/
const DEFAULT_JOBS_DIR = path.join(homedir(), '.gauntlet', 'jobs');

// UUID v4 regex for defense-in-depth validation (S-5)
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function assertValidJobId(jobId: string): void {
  if (!UUID_REGEX.test(jobId)) {
    throw new Error('Invalid job ID format');
  }
}

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
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Build and validate file path for a job ID (S-5)
 */
function buildJobFilePath(jobId: string): string {
  assertValidJobId(jobId);

  const jobsDir = getJobsDir();
  const filePath = path.join(jobsDir, `${jobId}.json`);

  // Defense-in-depth: verify the resolved path starts within jobsDir
  const resolved = path.resolve(filePath);
  const resolvedDir = path.resolve(jobsDir);
  if (!resolved.startsWith(resolvedDir + path.sep)) {
    throw new Error('Invalid job ID format');
  }

  return filePath;
}

/**
 * Save job output to disk (atomic write, S-9; 0o600 perms, CISO-11)
 */
export async function saveJobToDisk(
  jobId: string,
  output: GauntletOutput
): Promise<string> {
  assertValidJobId(jobId);
  await ensureJobsDir();

  const jobsDir = getJobsDir();
  const filePath = path.join(jobsDir, `${jobId}.json`);
  const tmpPath = filePath + '.tmp';

  const data = JSON.stringify(output, null, 2);
  await fs.writeFile(tmpPath, data, { encoding: 'utf-8', mode: 0o600 });
  await fs.rename(tmpPath, filePath);
  logger.logDebug('Job saved to disk', { jobId });
  return filePath;
}

/**
 * Load job output from disk
 */
export async function loadJobFromDisk(
  jobId: string
): Promise<GauntletOutput | null> {
  let filePath: string;
  try {
    filePath = buildJobFilePath(jobId);
  } catch {
    return null;
  }

  try {
    const data = await fs.readFile(filePath, 'utf-8');
    let output: GauntletOutput;
    try {
      output = JSON.parse(data) as GauntletOutput;
    } catch (parseError) {
      logger.logWarn('Corrupt job file on disk (JSON parse failed)', { jobId });
      return null;
    }

    // S-10: default jobType for legacy jobs loaded from disk
    if (!output.jobType) {
      output.jobType = 'prd_refinement';
    }

    logger.logDebug('Job loaded from disk', { jobId });
    return output;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.logDebug('Job not found on disk', { jobId });
      return null;
    }

    logger.logError('Failed to load job from disk', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * List all saved jobs with enriched metadata (D4)
 */
export async function listSavedJobs(): Promise<
  Array<{
    jobId: string;
    jobType: JobType;
    status: string;
    title?: string;
    savedAt: string;
    createdAt?: string;
    completedAt?: string;
    rounds?: number;
    cost?: number;
    consensusReached?: boolean;
    savedToDisk: true;
  }>
> {
  const jobsDir = getJobsDir();

  try {
    // Ensure directory exists
    await ensureJobsDir();

    const files = await fs.readdir(jobsDir);
    const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.endsWith('.tmp'));

    const jobs = await Promise.all(
      jsonFiles.map(async (file) => {
        const jobId = file.replace('.json', '');
        const filePath = path.join(jobsDir, file);

        try {
          const stats = await fs.stat(filePath);
          const data = await fs.readFile(filePath, 'utf-8');
          let output: any;
          try {
            output = JSON.parse(data);
          } catch {
            const stats2 = await fs.stat(filePath);
            return {
              jobId,
              jobType: 'prd_refinement' as JobType,
              status: 'complete',
              savedAt: stats2.mtime.toISOString(),
              savedToDisk: true as const,
            };
          }

          // D4: Derive status and consensusReached from saved fields or from debate outcomes
          let status: string = output.status ?? 'complete';
          let consensusReached: boolean | undefined = output.consensusReached;

          // Fallback: derive from debates outcome if not explicitly stored
          if (consensusReached === undefined && output.debates) {
            const debateValues = Object.values(output.debates) as any[];
            consensusReached = debateValues.length > 0 && debateValues.every(
              (d: any) => d && (d.outcome === 'consensus' || (d.summary && d.summary.outcome === 'consensus'))
            );
          }

          // Fallback: if divergenceReport present, status was consensus_failed
          if (!output.status && output.divergenceReport) {
            status = 'consensus_failed';
            consensusReached = false;
          }

          // D1: support summary.totalRounds / summary.estimatedCost (new) and stats (legacy)
          const rounds: number | undefined =
            output.summary?.totalRounds ?? output.stats?.totalRounds;
          const cost: number | undefined =
            output.summary?.estimatedCost ?? output.stats?.estimatedCost;

          return {
            jobId,
            jobType: (output.jobType ?? 'prd_refinement') as JobType,
            status,
            title: output.metadata?.title,
            savedAt: stats.mtime.toISOString(),
            createdAt: output.createdAt,
            completedAt: output.completedAt,
            rounds,
            cost,
            ...(consensusReached !== undefined && { consensusReached }),
            savedToDisk: true as const,
          };
        } catch (error) {
          logger.logWarn('Failed to read job metadata', {
            jobId,
            error: error instanceof Error ? error.message : 'Unknown error',
          });
          // Return minimal info if we can't parse the file
          try {
            const stats = await fs.stat(filePath);
            return {
              jobId,
              jobType: 'prd_refinement' as JobType,
              status: 'complete',
              savedAt: stats.mtime.toISOString(),
              savedToDisk: true as const,
            };
          } catch {
            return {
              jobId,
              jobType: 'prd_refinement' as JobType,
              status: 'complete',
              savedAt: new Date().toISOString(),
              savedToDisk: true as const,
            };
          }
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
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Delete a saved job
 */
export async function deleteJob(jobId: string): Promise<void> {
  let filePath: string;
  try {
    filePath = buildJobFilePath(jobId);
  } catch {
    throw new Error('Invalid job ID format');
  }

  try {
    await fs.unlink(filePath);
    logger.logDebug('Job deleted from disk', { jobId });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      logger.logDebug('Job file not found, already deleted', { jobId });
      return;
    }

    logger.logError('Failed to delete job', {
      jobId,
      error: error instanceof Error ? error.message : 'Unknown error',
    });
    throw error;
  }
}

/**
 * Check if a job is saved on disk
 */
export async function isJobSaved(jobId: string): Promise<boolean> {
  let filePath: string;
  try {
    filePath = buildJobFilePath(jobId);
  } catch {
    return false;
  }

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
