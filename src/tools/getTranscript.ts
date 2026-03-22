// ============================================================================
// get_debate_transcript Tool - Retrieve full debate transcript (FR3)
// ============================================================================

import { z } from 'zod';
import type { TranscriptOutput, TranscriptError, CriticModel } from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';
import { loadJobFromDisk } from '../utils/jobPersistence.js';

// Input schema
export const TranscriptInputSchema = z.object({
  jobId: z.string().uuid(),
  model: z.enum(['chatgpt', 'gemini']),
});

export type TranscriptInput = z.infer<typeof TranscriptInputSchema>;

export async function handleGetTranscript(
  input: unknown
): Promise<TranscriptOutput | TranscriptError> {
  // Validate input
  const parseResult = TranscriptInputSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      error: 'JOB_NOT_FOUND',
      message: `Invalid input: ${parseResult.error.message}`,
    };
  }

  const { jobId, model } = parseResult.data;

  // Look up job in memory
  const job = jobStore.get(jobId);
  if (!job) {
    // Disk fallback: try to load saved job
    try {
      const savedOutput = await loadJobFromDisk(jobId);
      if (savedOutput) {
        const debates = (savedOutput as any).debates;
        if (debates) {
          const modelKey = model as CriticModel;
          const debate = debates[modelKey];
          if (debate) {
            return {
              transcript: {
                summary: debate.summary ?? {
                  rounds: debate.rounds ?? 0,
                  outcome: debate.outcome ?? 'unknown',
                  keyChanges: debate.keyChanges ?? [],
                },
                messages: debate.messages ?? debate.exchanges ?? [],
              },
            };
          }
          return {
            error: 'TRANSCRIPT_UNAVAILABLE',
            message: `No transcript found for model ${model} in saved job.`,
          };
        }
        // Saved job exists but no debates stored
        return {
          error: 'TRANSCRIPT_UNAVAILABLE',
          message: 'Transcripts were not included in the saved job. Run the job again with includeTranscripts: true.',
        };
      }
    } catch {
      // Disk load failed, fall through to JOB_NOT_FOUND
    }
    return {
      error: 'JOB_NOT_FOUND',
      message: 'Job ID not found in memory or on disk.',
    };
  }

  // Check if critic was skipped
  if (job.result?.stats?.skippedCritics) {
    const skipped = job.result.stats.skippedCritics.find(
      (s) => s.model === model
    );
    if (skipped) {
      return {
        error: 'CRITIC_SKIPPED',
        message: `This critic was skipped due to: ${skipped.reason}`,
      };
    }
  }

  // Get transcript from memory
  const transcript = jobStore.getTranscript(jobId, model as CriticModel);
  if (!transcript) {
    return {
      error: 'TRANSCRIPT_UNAVAILABLE',
      message: 'Transcript not stored or server restarted.',
    };
  }

  return {
    transcript,
  };
}
