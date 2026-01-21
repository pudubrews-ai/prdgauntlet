// ============================================================================
// Terminology Cache - Shared cache for researched terms (PRD v3.0)
// ============================================================================

import { logger } from './logger.js';

export interface CachedTerm {
  term: string;
  fullName: string;
  version: string;
  sourceUrl: string;
  specification: string;
  cachedAt: Date;
}

export interface TerminologyCache {
  get(term: string): CachedTerm | null;
  set(term: string, definition: CachedTerm): void;
  has(term: string): boolean;
  clear(): void;
  getStats(): { hits: number; misses: number; size: number };
}

class InMemoryTerminologyCache implements TerminologyCache {
  private cache: Map<string, CachedTerm> = new Map();
  private ttl: number = 24 * 60 * 60 * 1000; // 24 hours in ms
  private hits: number = 0;
  private misses: number = 0;

  constructor(ttlMs?: number) {
    if (ttlMs) {
      this.ttl = ttlMs;
    }

    // Start cleanup interval (every hour)
    setInterval(() => this.cleanup(), 60 * 60 * 1000);
  }

  /**
   * Normalize URL for cache key
   * - Convert to lowercase
   * - Force HTTPS
   * - Strip trailing slashes
   * - Preserve query params (can be semantic)
   */
  private normalizeUrl(url: string): string {
    return url
      .toLowerCase()
      .replace(/^http:/, 'https:')
      .replace(/\/$/, '')
      .trim();
  }

  /**
   * Build cache key: "term:version:normalizedUrl"
   */
  private buildKey(term: string, version: string, url: string): string {
    return `${term}:${version}:${this.normalizeUrl(url)}`;
  }

  /**
   * Extract cache key from cached term
   */
  private getKeyFromTerm(cached: CachedTerm): string {
    return this.buildKey(cached.term, cached.version, cached.sourceUrl);
  }

  get(term: string): CachedTerm | null {
    // Try exact term match first
    for (const [key, cached] of this.cache.entries()) {
      if (key.startsWith(`${term}:`)) {
        // Check TTL
        const age = Date.now() - cached.cachedAt.getTime();
        if (age > this.ttl) {
          this.cache.delete(key);
          this.misses++;
          return null;
        }

        this.hits++;
        logger.logDebug('Terminology cache HIT', { term, key });
        return cached;
      }
    }

    this.misses++;
    logger.logDebug('Terminology cache MISS', { term });
    return null;
  }

  set(term: string, definition: CachedTerm): void {
    const key = this.getKeyFromTerm(definition);
    this.cache.set(key, definition);
    logger.logDebug('Terminology cached', { term, version: definition.version });
  }

  has(term: string): boolean {
    return this.get(term) !== null;
  }

  clear(): void {
    const previousSize = this.cache.size;
    this.cache.clear();
    this.hits = 0;
    this.misses = 0;
    logger.logInfo('Terminology cache cleared', { previousSize });
  }

  getStats(): { hits: number; misses: number; size: number } {
    return {
      hits: this.hits,
      misses: this.misses,
      size: this.cache.size,
    };
  }

  /**
   * Remove expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let removedCount = 0;

    for (const [key, cached] of this.cache.entries()) {
      const age = now - cached.cachedAt.getTime();
      if (age > this.ttl) {
        this.cache.delete(key);
        removedCount++;
      }
    }

    if (removedCount > 0) {
      logger.logDebug('Terminology cache cleanup', { removedCount, remaining: this.cache.size });
    }
  }
}

// Global singleton instance
let globalCache: TerminologyCache | null = null;

export function getTerminologyCache(): TerminologyCache {
  if (!globalCache) {
    globalCache = new InMemoryTerminologyCache();
  }
  return globalCache;
}

export function clearTerminologyCache(): void {
  if (globalCache) {
    globalCache.clear();
  }
}

export function getTerminologyCacheStats(): { hits: number; misses: number; size: number } {
  return globalCache ? globalCache.getStats() : { hits: 0, misses: 0, size: 0 };
}
