// ============================================================================
// get_debate_transcript Tool - Retrieve full debate transcript (FR3)
// ============================================================================

import { z } from 'zod';
import type { TranscriptOutput, TranscriptError, CriticModel } from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';

// Input schema
export const TranscriptInputSchema = z.object({
  jobId: z.string().uuid(),
  model: z.enum(['chatgpt', 'gemini']),
});

export type TranscriptInput = z.infer<typeof TranscriptInputSchema>;

export function handleGetTranscript(
  input: unknown
): TranscriptOutput | TranscriptError {
  // Validate input
  const parseResult = TranscriptInputSchema.safeParse(input);
  if (!parseResult.success) {
    return {
      error: 'JOB_NOT_FOUND',
      message: `Invalid input: ${parseResult.error.message}`,
    };
  }

  const { jobId, model } = parseResult.data;

  // Look up job
  const job = jobStore.get(jobId);
  if (!job) {
    return {
      error: 'JOB_NOT_FOUND',
      message: 'Job ID not found. Jobs are ephemeral and lost on server restart.',
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

  // Get transcript
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
