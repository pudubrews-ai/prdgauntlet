// ============================================================================
// Webhook Support - User notifications with HMAC and retry (PRD v3.0)
// ============================================================================

import crypto from 'crypto';
import type { WebhookPayload, WebhookAuth } from '../types/index.js';
import { logger } from './logger.js';

/**
 * Generate HMAC secret for webhook authentication
 */
export function generateHmacSecret(): string {
  return `wh_sec_${crypto.randomBytes(32).toString('hex')}`;
}

/**
 * Generate HMAC signature for webhook payload
 */
export function generateHmacSignature(
  payload: string,
  secret: string
): string {
  const hmac = crypto.createHmac('sha256', secret);
  hmac.update(payload);
  return `sha256=${hmac.digest('hex')}`;
}

/**
 * Verify HMAC signature from webhook response
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = generateHmacSignature(payload, secret);
  return crypto.timingSafeEqual(
    Buffer.from(signature),
    Buffer.from(expected)
  );
}

/**
 * Retry configuration
 */
interface RetryConfig {
  maxAttempts: number;
  delays: number[]; // Exponential backoff delays in ms
}

const DEFAULT_RETRY_CONFIG: RetryConfig = {
  maxAttempts: 3,
  delays: [1000, 2000, 4000], // 1s, 2s, 4s
};

/**
 * Send webhook with retry logic
 */
export async function sendWebhook(
  url: string,
  payload: WebhookPayload,
  auth?: WebhookAuth,
  config: RetryConfig = DEFAULT_RETRY_CONFIG
): Promise<{ success: boolean; attempts: number; error?: string }> {
  const payloadJson = JSON.stringify(payload);
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < config.maxAttempts; attempt++) {
    try {
      logger.logDebug('Sending webhook', {
        url,
        attempt: attempt + 1,
        jobId: payload.jobId,
      });

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
      };

      // Add authentication
      if (auth) {
        if (auth.type === 'bearer' && auth.token) {
          headers['Authorization'] = `Bearer ${auth.token}`;
        } else if (auth.type === 'hmac' && auth.secret) {
          const signature = generateHmacSignature(payloadJson, auth.secret);
          headers['X-Gauntlet-Signature'] = signature;
        }
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: payloadJson,
      });

      if (response.ok) {
        logger.logInfo('Webhook delivered successfully', {
          url,
          attempts: attempt + 1,
          jobId: payload.jobId,
        });

        return { success: true, attempts: attempt + 1 };
      }

      // Handle rate limiting (429)
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter
          ? parseInt(retryAfter, 10) * 1000
          : config.delays[attempt] || 4000;

        logger.logWarn('Webhook rate limited, retrying', {
          url,
          retryAfter: delay,
        });

        await sleep(delay);
        continue;
      }

      // Don't retry on 4xx errors (except 429)
      if (response.status >= 400 && response.status < 500) {
        logger.logError('Webhook failed with client error', {
          url,
          status: response.status,
          jobId: payload.jobId,
        });

        return {
          success: false,
          attempts: attempt + 1,
          error: `Client error: ${response.status}`,
        };
      }

      // Retry on 5xx errors
      throw new Error(`Server error: ${response.status}`);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));

      logger.logWarn('Webhook attempt failed', {
        url,
        attempt: attempt + 1,
        error: lastError.message,
      });

      // Wait before retry (except on last attempt)
      if (attempt < config.maxAttempts - 1) {
        await sleep(config.delays[attempt] || 4000);
      }
    }
  }

  // All retries exhausted
  logger.logError('Webhook delivery failed after all retries', {
    url,
    attempts: config.maxAttempts,
    error: lastError?.message,
  });

  return {
    success: false,
    attempts: config.maxAttempts,
    error: lastError?.message || 'Unknown error',
  };
}

/**
 * Sleep utility
 */
function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Validate webhook URL
 */
export function validateWebhookUrl(url: string): {
  valid: boolean;
  error?: string;
} {
  try {
    const parsed = new URL(url);

    // Must be HTTPS
    if (parsed.protocol !== 'https:') {
      return {
        valid: false,
        error: 'Webhook URL must use HTTPS',
      };
    }

    // Block localhost and internal IPs
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname.match(/^10\./) ||
      parsed.hostname.match(/^192\.168\./) ||
      parsed.hostname.match(/^172\.(1[6-9]|2[0-9]|3[0-1])\./)
    ) {
      return {
        valid: false,
        error: 'Webhook URL cannot be localhost or internal IP',
      };
    }

    return { valid: true };
  } catch (error) {
    return {
      valid: false,
      error: 'Invalid URL format',
    };
  }
}
