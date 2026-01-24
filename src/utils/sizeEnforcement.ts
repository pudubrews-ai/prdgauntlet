// ============================================================================
// Output Size Enforcement - 75KB limit with atomic round completion (PRD v3.0)
// ============================================================================

import { logger } from './logger.js';

/**
 * Size limits (configurable via env)
 */
export const INPUT_SIZE_LIMIT_KB =
  parseInt(process.env.INPUT_SIZE_LIMIT_KB || '200', 10);
export const OUTPUT_SIZE_LIMIT_KB =
  parseInt(process.env.OUTPUT_SIZE_LIMIT_KB || '75', 10);

/**
 * Check PRD size against limits
 */
export function checkPrdSize(
  prd: string,
  isInput: boolean = false
): {
  ok: boolean;
  sizeKB: number;
  limitKB: number;
  error?: string;
} {
  const sizeBytes = Buffer.byteLength(prd, 'utf8');
  const sizeKB = sizeBytes / 1024;
  const limitKB = isInput ? INPUT_SIZE_LIMIT_KB : OUTPUT_SIZE_LIMIT_KB;

  if (sizeKB > limitKB) {
    const error = isInput
      ? `Input PRD exceeds ${limitKB}KB limit (actual: ${sizeKB.toFixed(1)}KB). Consider splitting into smaller documents.`
      : `Output PRD exceeds ${limitKB}KB limit (actual: ${sizeKB.toFixed(1)}KB). PRD grew too large during refinement.`;

    logger.logWarn('PRD size limit exceeded', {
      sizeKB: sizeKB.toFixed(1),
      limitKB,
      isInput,
    });

    return {
      ok: false,
      sizeKB,
      limitKB,
      error,
    };
  }

  return {
    ok: true,
    sizeKB,
    limitKB,
  };
}

/**
 * Check if PRD will exceed output limit after adding content
 */
export function willExceedOutputLimit(
  currentPrd: string,
  additionalContent: string
): {
  willExceed: boolean;
  currentSizeKB: number;
  estimatedSizeKB: number;
  limitKB: number;
} {
  const currentSize = Buffer.byteLength(currentPrd, 'utf8');
  const additionalSize = Buffer.byteLength(additionalContent, 'utf8');
  const estimatedSize = currentSize + additionalSize;

  const currentSizeKB = currentSize / 1024;
  const estimatedSizeKB = estimatedSize / 1024;
  const limitKB = OUTPUT_SIZE_LIMIT_KB;

  return {
    willExceed: estimatedSizeKB > limitKB,
    currentSizeKB,
    estimatedSizeKB,
    limitKB,
  };
}

/**
 * Generate size limit error for API response
 */
export function generateSizeLimitError(
  sizeKB: number,
  limitKB: number,
  roundCompleted: number,
  partialPrd: string
): {
  error: 'output_size_exceeded';
  details: {
    finalSize: string;
    limit: string;
    roundCompleted: number;
    partialPrd: string;
  };
  userOptions: string[];
} {
  return {
    error: 'output_size_exceeded',
    details: {
      finalSize: `${sizeKB.toFixed(1)}KB`,
      limit: `${limitKB}KB`,
      roundCompleted,
      partialPrd,
    },
    userOptions: [
      `Use partial PRD (complete through Round ${roundCompleted})`,
      'Increase size limit via config and resubmit',
      'Split PRD into multiple smaller documents',
    ],
  };
}
