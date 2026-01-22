// ============================================================================
// Memory Monitor - Heap pressure detection and graceful degradation (PRD v3.0)
// ============================================================================

import { logger } from './logger.js';

/**
 * Memory thresholds (configurable via env vars)
 */
export const HEAP_WARNING_PERCENT =
  parseInt(process.env.HEAP_WARNING_PERCENT || '80', 10);
export const HEAP_CRITICAL_PERCENT =
  parseInt(process.env.HEAP_CRITICAL_PERCENT || '95', 10);

/**
 * Memory monitor singleton
 */
class MemoryMonitor {
  private intervalId: NodeJS.Timeout | null = null;
  private checkInterval = 5000; // 5 seconds
  private onWarning?: () => void;
  private onCritical?: () => void;

  /**
   * Start monitoring heap usage
   */
  start(options?: {
    onWarning?: () => void;
    onCritical?: () => void;
  }): void {
    if (this.intervalId) {
      logger.logWarn('Memory monitor already running');
      return;
    }

    this.onWarning = options?.onWarning;
    this.onCritical = options?.onCritical;

    this.intervalId = setInterval(() => {
      this.checkMemory();
    }, this.checkInterval);

    logger.logInfo('Memory monitor started', {
      warningThreshold: HEAP_WARNING_PERCENT + '%',
      criticalThreshold: HEAP_CRITICAL_PERCENT + '%',
    });
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
      logger.logInfo('Memory monitor stopped');
    }
  }

  /**
   * Check current memory usage
   */
  checkMemory(): void {
    const usage = process.memoryUsage();
    const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;

    if (heapUsedPercent >= HEAP_CRITICAL_PERCENT) {
      logger.logError('CRITICAL: Heap at critical level', {
        heapUsedPercent: heapUsedPercent.toFixed(1) + '%',
        heapUsedMB: (usage.heapUsed / 1024 / 1024).toFixed(1),
        heapTotalMB: (usage.heapTotal / 1024 / 1024).toFixed(1),
      });

      if (this.onCritical) {
        this.onCritical();
      }
    } else if (heapUsedPercent >= HEAP_WARNING_PERCENT) {
      logger.logWarn('WARNING: Heap at warning level', {
        heapUsedPercent: heapUsedPercent.toFixed(1) + '%',
        heapUsedMB: (usage.heapUsed / 1024 / 1024).toFixed(1),
        heapTotalMB: (usage.heapTotal / 1024 / 1024).toFixed(1),
      });

      if (this.onWarning) {
        this.onWarning();
      }
    }
  }

  /**
   * Get current memory stats
   */
  getStats(): {
    heapUsedPercent: number;
    heapUsedMB: number;
    heapTotalMB: number;
    isWarning: boolean;
    isCritical: boolean;
  } {
    const usage = process.memoryUsage();
    const heapUsedPercent = (usage.heapUsed / usage.heapTotal) * 100;

    return {
      heapUsedPercent,
      heapUsedMB: usage.heapUsed / 1024 / 1024,
      heapTotalMB: usage.heapTotal / 1024 / 1024,
      isWarning: heapUsedPercent >= HEAP_WARNING_PERCENT,
      isCritical: heapUsedPercent >= HEAP_CRITICAL_PERCENT,
    };
  }

  /**
   * Check if system has capacity for new work
   */
  checkCapacity(): {
    hasCapacity: boolean;
    heapUsedPercent: number;
    recommendation?: string;
  } {
    const stats = this.getStats();

    if (stats.isCritical) {
      return {
        hasCapacity: false,
        heapUsedPercent: stats.heapUsedPercent,
        recommendation: 'System at capacity. Please retry in 5 minutes.',
      };
    }

    if (stats.isWarning) {
      return {
        hasCapacity: true,
        heapUsedPercent: stats.heapUsedPercent,
        recommendation: 'System memory is elevated but still accepting requests.',
      };
    }

    return {
      hasCapacity: true,
      heapUsedPercent: stats.heapUsedPercent,
    };
  }
}

// Export singleton instance
export const memoryMonitor = new MemoryMonitor();

/**
 * Check if system has capacity for new jobs
 */
export function hasCapacityForNewJob(): {
  allowed: boolean;
  reason?: string;
} {
  const stats = memoryMonitor.getStats();

  if (stats.isCritical) {
    return {
      allowed: false,
      reason: `System at capacity (${stats.heapUsedPercent.toFixed(1)}% heap used). Retry in 5 minutes.`,
    };
  }

  return { allowed: true };
}

/**
 * Trigger transcript compression for oldest jobs
 * Priority: active > recent > old
 */
export function compressOldestTranscripts(): void {
  logger.logInfo('Compressing oldest transcripts to free memory');

  // This will be implemented in jobStore to actually compress transcripts
  // For now, just log the action
  // The jobStore will need to:
  // 1. Sort jobs by lastUpdate (oldest first)
  // 2. For each job not in 'debating_*' status:
  //    - Convert full transcript to summary-only
  //    - Free the memory
}
