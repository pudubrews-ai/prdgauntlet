// ============================================================================
// clear_terminology_cache Tool - Manual cache invalidation (PRD v3.0)
// ============================================================================

import { clearTerminologyCache, getTerminologyCacheStats } from '../utils/terminologyCache.js';
import { logger } from '../utils/logger.js';

export interface ClearCacheOutput {
  success: boolean;
  message: string;
  previousStats: {
    hits: number;
    misses: number;
    size: number;
  };
}

export function handleClearCache(): ClearCacheOutput {
  logger.logInfo('clear_terminology_cache called');

  // Get stats before clearing
  const previousStats = getTerminologyCacheStats();

  // Clear the cache
  clearTerminologyCache();

  logger.logInfo('Terminology cache cleared', {
    previousSize: previousStats.size,
    hits: previousStats.hits,
    misses: previousStats.misses,
  });

  return {
    success: true,
    message: `Terminology cache cleared successfully. Previous cache had ${previousStats.size} entries with ${previousStats.hits} hits and ${previousStats.misses} misses.`,
    previousStats,
  };
}
