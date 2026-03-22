// ============================================================================
// Webhook Support - User notifications with HMAC and retry (PRD v3.0)
// ============================================================================

import crypto from 'crypto';
import dns from 'dns';
import { promisify } from 'util';
import type { WebhookPayload, WebhookAuth } from '../types/index.js';
import { logger } from './logger.js';

const resolve4 = promisify(dns.resolve4);
const resolve6 = promisify(dns.resolve6);

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
 * Verify HMAC signature from webhook response (S-2: buffer length check)
 */
export function verifyHmacSignature(
  payload: string,
  signature: string,
  secret: string
): boolean {
  const expected = generateHmacSignature(payload, secret);
  const sigBuf = Buffer.from(signature);
  const expBuf = Buffer.from(expected);
  if (sigBuf.length !== expBuf.length) {
    return false;
  }
  return crypto.timingSafeEqual(sigBuf, expBuf);
}

/**
 * Check if a string represents a decimal-encoded IP and parse it.
 * e.g. "2130706433" => "127.0.0.1"
 */
function parseDecimalIp(hostname: string): string | null {
  // Pure decimal number?
  if (/^\d+$/.test(hostname)) {
    const num = parseInt(hostname, 10);
    if (num >= 0 && num <= 0xFFFFFFFF) {
      return [
        (num >>> 24) & 0xff,
        (num >>> 16) & 0xff,
        (num >>> 8) & 0xff,
        num & 0xff,
      ].join('.');
    }
  }
  return null;
}

/**
 * Check if an IPv4 address falls within a private/restricted range (S-3)
 */
function isPrivateIpv4(ip: string): boolean {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some(p => isNaN(p))) return false;

  const [a, b] = parts;

  // 127.0.0.0/8
  if (a === 127) return true;
  // 10.0.0.0/8
  if (a === 10) return true;
  // 172.16.0.0/12
  if (a === 172 && b >= 16 && b <= 31) return true;
  // 192.168.0.0/16
  if (a === 192 && b === 168) return true;
  // 169.254.0.0/16 (link-local / AWS metadata)
  if (a === 169 && b === 254) return true;
  // 0.0.0.0
  if (ip === '0.0.0.0') return true;

  return false;
}

/**
 * Check if an IPv6 address falls within a restricted range (S-3)
 */
function isPrivateIpv6(ip: string): boolean {
  const lower = ip.toLowerCase().replace(/^\[/, '').replace(/\]$/, '');

  // ::1 (loopback)
  if (lower === '::1') return true;
  // fc00::/7 (ULA) - starts with fc or fd
  if (lower.startsWith('fc') || lower.startsWith('fd')) return true;
  // fe80::/10 (link-local) - starts with fe8, fe9, fea, feb
  if (/^fe[89ab]/i.test(lower)) return true;

  return false;
}

/**
 * Validate webhook URL with DNS resolution to block SSRF (S-3)
 */
export async function validateWebhookUrl(url: string): Promise<{
  valid: boolean;
  error?: string;
}> {
  try {
    const parsed = new URL(url);

    // Must be HTTPS
    if (parsed.protocol !== 'https:') {
      return { valid: false, error: 'Webhook URL must use HTTPS' };
    }

    let hostname = parsed.hostname;

    // Block bracket-enclosed IPv6 literals
    if (hostname.startsWith('[') && hostname.endsWith(']')) {
      const ipv6 = hostname.slice(1, -1);
      if (isPrivateIpv6(ipv6)) {
        return { valid: false, error: 'Webhook URL cannot point to a private or internal address' };
      }
    }

    // Block decimal-encoded IPs
    const decimalIp = parseDecimalIp(hostname);
    if (decimalIp !== null) {
      if (isPrivateIpv4(decimalIp)) {
        return { valid: false, error: 'Webhook URL cannot point to a private or internal address' };
      }
    }

    // Resolve DNS to check actual IPs
    const ipv4Addrs: string[] = await resolve4(hostname).catch(() => []);
    const ipv6Addrs: string[] = await resolve6(hostname).catch(() => []);

    // If both fail, DNS resolution failed — reject
    if (ipv4Addrs.length === 0 && ipv6Addrs.length === 0) {
      return { valid: false, error: 'Webhook URL hostname could not be resolved' };
    }

    for (const ip of ipv4Addrs) {
      if (isPrivateIpv4(ip)) {
        return { valid: false, error: 'Webhook URL cannot point to a private or internal address' };
      }
    }

    for (const ip of ipv6Addrs) {
      if (isPrivateIpv6(ip)) {
        return { valid: false, error: 'Webhook URL cannot point to a private or internal address' };
      }
    }

    return { valid: true };
  } catch (error) {
    return { valid: false, error: 'Invalid URL format' };
  }
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

      // Handle rate limiting (429) — cap retry-after to 30s (Adversary Finding 9)
      if (response.status === 429) {
        const retryAfter = response.headers.get('retry-after');
        const delay = retryAfter
          ? Math.min(parseInt(retryAfter, 10) * 1000, 30000)
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
