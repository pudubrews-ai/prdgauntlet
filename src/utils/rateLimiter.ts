// ============================================================================
// Rate Limiter - Server-level rate limiting (FR12)
// ============================================================================

import type { RateLimitConfig } from '../types/index.js';

/**
 * Token bucket rate limiter for controlling request frequency.
 * Implements FR12: Server-level rate limiting with configurable
 * requests per minute and burst size.
 *
 * State is in-memory and resets on server restart.
 */
export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number; // tokens per millisecond

  constructor(config: RateLimitConfig) {
    this.maxTokens = config.burstSize;
    this.tokens = config.burstSize;
    this.lastRefill = Date.now();
    // Convert requests per minute to tokens per millisecond
    this.refillRate = config.requestsPerMinute / 60_000;
  }

  /**
   * Refill tokens based on elapsed time since last refill.
   */
  private refill(): void {
    const now = Date.now();
    const elapsed = now - this.lastRefill;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }

  /**
   * Attempt to acquire a token for a request.
   *
   * @returns Object indicating if request is allowed, and retry delay if not
   */
  tryAcquire(): { allowed: boolean; retryAfter?: number } {
    this.refill();

    if (this.tokens >= 1) {
      this.tokens -= 1;
      return { allowed: true };
    }

    // Calculate how long until a token is available
    const tokensNeeded = 1 - this.tokens;
    const retryAfterMs = Math.ceil(tokensNeeded / this.refillRate);
    const retryAfterSeconds = Math.ceil(retryAfterMs / 1000);

    return {
      allowed: false,
      retryAfter: retryAfterSeconds,
    };
  }

  /**
   * Get current available tokens (for monitoring/debugging).
   */
  getAvailableTokens(): number {
    this.refill();
    return this.tokens;
  }

  /**
   * Reset the rate limiter to full capacity.
   */
  reset(): void {
    this.tokens = this.maxTokens;
    this.lastRefill = Date.now();
  }
}

// Singleton instance for server-wide rate limiting
let globalRateLimiter: RateLimiter | null = null;

/**
 * Get the global rate limiter instance.
 * Creates one with default config if not initialized.
 */
export function getGlobalRateLimiter(config?: RateLimitConfig): RateLimiter {
  if (!globalRateLimiter) {
    globalRateLimiter = new RateLimiter(
      config ?? { requestsPerMinute: 10, burstSize: 3 }
    );
  }
  return globalRateLimiter;
}

/**
 * Initialize or reinitialize the global rate limiter with new config.
 */
export function initGlobalRateLimiter(config: RateLimitConfig): RateLimiter {
  globalRateLimiter = new RateLimiter(config);
  return globalRateLimiter;
}

/**
 * Reset the global rate limiter (useful for testing).
 */
export function resetGlobalRateLimiter(): void {
  globalRateLimiter = null;
}
