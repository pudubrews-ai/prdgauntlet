// ============================================================================
// gauntlet_health Tool - Server health check
// ============================================================================

import { z } from 'zod';
import type { GauntletConfig, HealthOutput } from '../types/index.js';
import { jobStore } from '../utils/jobStore.js';
import {
  getValidationCache,
  refreshValidation,
  getValidationStatus,
} from '../clients/validator.js';

// Input schema
export const HealthInputSchema = z.object({
  forceRefresh: z.boolean().default(false),
});

export type HealthInput = z.infer<typeof HealthInputSchema>;

const SERVER_START_TIME = Date.now();
const VERSION = '1.0.0';

export async function handleHealth(
  input: unknown,
  config: GauntletConfig
): Promise<HealthOutput> {
  const parseResult = HealthInputSchema.safeParse(input);
  const forceRefresh = parseResult.success ? parseResult.data.forceRefresh : false;

  // Refresh validation if requested
  if (forceRefresh) {
    await refreshValidation(config);
  }

  const validationCache = getValidationCache();
  const status = getValidationStatus();

  // Build provider status
  const providers = validationCache
    ? {
        claude: validationCache.claude,
        chatgpt: validationCache.chatgpt,
        gemini: validationCache.gemini,
      }
    : {
        claude: {
          model: 'claude' as const,
          modelId: config.models.claude,
          valid: false,
          error: 'Not validated yet',
          timestamp: new Date().toISOString(),
        },
        chatgpt: {
          model: 'chatgpt' as const,
          modelId: config.models.chatgpt,
          valid: false,
          error: 'Not validated yet',
          timestamp: new Date().toISOString(),
        },
        gemini: {
          model: 'gemini' as const,
          modelId: config.models.gemini,
          valid: false,
          error: 'Not validated yet',
          timestamp: new Date().toISOString(),
        },
      };

  return {
    status,
    version: VERSION,
    uptime: Math.floor((Date.now() - SERVER_START_TIME) / 1000),
    activeJobs: jobStore.getActiveCount(),
    maxConcurrentJobs: config.maxConcurrentJobs,
    providers,
    config: {
      maxRoundsPerModel: config.maxRoundsPerModel,
      maxTotalTokens: config.maxTotalTokens,
      maxEstimatedCost: config.maxEstimatedCost,
      retryOnTimeout: config.retryOnTimeout,
    },
  };
}
