// ============================================================================
// Conflict Resolution - Handle cross-critic disputes (FR6)
// ============================================================================

import type { ChangeEntry, ChangeType, CriticModel, RevertLock } from '../types/index.js';
import { logger } from '../utils/logger.js';

export interface ConflictDetection {
  hasConflict: boolean;
  conflictingChanges?: {
    original: ChangeEntry;
    disputing: ChangeEntry;
  };
  conflictDescription?: string;
}

export function detectConflict(
  currentChanges: ChangeEntry[],
  newChange: ChangeEntry
): ConflictDetection {
  // Check if the new change is a revert
  if (newChange.type === 'revert' && newChange.revertedChange !== undefined) {
    const originalChange = currentChanges.find(
      (c) => c.version === newChange.revertedChange
    );

    if (originalChange && originalChange.source !== newChange.source) {
      return {
        hasConflict: true,
        conflictingChanges: {
          original: originalChange,
          disputing: newChange,
        },
        conflictDescription: `${newChange.source} reverted v${originalChange.version} change by ${originalChange.source}: "${originalChange.summary}"`,
      };
    }
  }

  // Check for changes to the same section by different critics
  if (newChange.section) {
    const sameSection = currentChanges.filter(
      (c) =>
        c.section &&
        c.source !== newChange.source &&
        sectionsOverlap(c.section, newChange.section!)
    );

    if (sameSection.length > 0) {
      const mostRecent = sameSection[sameSection.length - 1];
      return {
        hasConflict: true,
        conflictingChanges: {
          original: mostRecent,
          disputing: newChange,
        },
        conflictDescription: `${newChange.source} modified section "${newChange.section}" which was previously changed by ${mostRecent.source}`,
      };
    }
  }

  return { hasConflict: false };
}

function sectionsOverlap(section1: string, section2: string): boolean {
  // Normalize section paths for comparison
  const normalize = (s: string) =>
    s
      .toLowerCase()
      .replace(/\s*>\s*/g, '>')
      .replace(/\s+/g, ' ')
      .trim();

  const s1 = normalize(section1);
  const s2 = normalize(section2);

  // Direct match
  if (s1 === s2) return true;

  // One is parent of the other
  if (s1.startsWith(s2 + '>') || s2.startsWith(s1 + '>')) return true;

  // Same parent section
  const parent1 = s1.split('>')[0];
  const parent2 = s2.split('>')[0];
  if (parent1 === parent2 && parent1.length > 0) return true;

  return false;
}

export function summarizeConflicts(changes: ChangeEntry[]): string[] {
  const conflicts: string[] = [];
  const processed = new Set<number>();

  for (const change of changes) {
    if (change.type === 'revert' && change.revertedChange !== undefined) {
      if (processed.has(change.version)) continue;
      processed.add(change.version);

      const original = changes.find((c) => c.version === change.revertedChange);
      if (original && original.source !== change.source) {
        conflicts.push(
          `v${change.version} (${change.source}) reverted v${original.version} (${original.source}): ${change.summary}`
        );
      }
    }
  }

  return conflicts;
}

export function getConflictsBySource(
  changes: ChangeEntry[]
): Record<CriticModel, number> {
  const counts: Record<CriticModel, number> = {
    chatgpt: 0,
    gemini: 0,
  };

  for (const change of changes) {
    if (change.type === 'revert') {
      counts[change.source]++;
    }
  }

  return counts;
}

export function buildConflictContext(
  changes: ChangeEntry[],
  disputingCritic: CriticModel
): string {
  const relevantChanges = changes.filter((c) => c.source !== disputingCritic);

  if (relevantChanges.length === 0) {
    return '';
  }

  const lines = ['Previous changes from other reviewer:'];

  for (const change of relevantChanges) {
    lines.push(
      `- v${change.version} [${change.source}] ${change.type}: ${change.summary}`
    );
  }

  return lines.join('\n');
}

// ============================================================================
// Revert Lock Manager (FR6) - Prevent infinite ping-pong between critics
// ============================================================================

/**
 * Manages revert locks to prevent critics from endlessly reverting each other.
 * Per FR6: After a revert, the section+changeType is locked from further reverts
 * unless forceUnlockReverts is enabled.
 */
export class RevertLockManager {
  private locks: Map<string, RevertLock> = new Map();
  private sectionModificationCounts: Map<string, number> = new Map();
  private forceUnlock: boolean;

  constructor(forceUnlockReverts: boolean = false) {
    this.forceUnlock = forceUnlockReverts;
    if (forceUnlockReverts) {
      logger.logWarn('Force unlock enabled - revert locks disabled for this gauntlet run');
    }
  }

  /**
   * Generate a unique key for a lock based on section and change type.
   */
  private getLockKey(section: string, changeType: ChangeType): string {
    const normalizedSection = section.toLowerCase().replace(/\s+/g, ' ').trim();
    return `${normalizedSection}::${changeType}`;
  }

  /**
   * Check if a change is locked (cannot be reverted again).
   */
  isLocked(section: string | undefined, changeType: ChangeType): boolean {
    if (this.forceUnlock) return false;
    if (!section) return false;
    return this.locks.has(this.getLockKey(section, changeType));
  }

  /**
   * Add a lock after a revert occurs.
   * Per FR6: Lock prevents the same section+changeType from being re-reverted.
   */
  addLock(change: ChangeEntry): void {
    if (!change.section) return;

    const lock: RevertLock = {
      section: change.section,
      changeType: change.type,
      lockedAt: change.version,
      source: change.source,
    };

    const key = this.getLockKey(change.section, change.type);
    this.locks.set(key, lock);

    logger.logDebug(`Revert lock added: ${key} at v${change.version} by ${change.source}`);
  }

  /**
   * Track section modification for high-conflict detection.
   * Per FR6: If section modified ≥3 times, it's flagged as high-conflict.
   */
  trackSectionModification(section: string | undefined): void {
    if (!section) return;
    const normalized = section.toLowerCase().replace(/\s+/g, ' ').trim();
    const count = (this.sectionModificationCounts.get(normalized) ?? 0) + 1;
    this.sectionModificationCounts.set(normalized, count);
  }

  /**
   * Get sections with high conflict (modified ≥3 times).
   */
  getHighConflictSections(): string[] {
    const highConflict: string[] = [];
    for (const [section, count] of this.sectionModificationCounts) {
      if (count >= 3) {
        highConflict.push(section);
      }
    }
    return highConflict;
  }

  /**
   * Check if a section should receive jitter (modified ≥2 times).
   * Per FR6: Jitter breaks deterministic loops by adding random prioritization.
   */
  shouldApplyJitter(section: string | undefined): boolean {
    if (!section) return false;
    const normalized = section.toLowerCase().replace(/\s+/g, ' ').trim();
    return (this.sectionModificationCounts.get(normalized) ?? 0) >= 2;
  }

  /**
   * Get all active locks (for debugging/logging).
   */
  getLocks(): RevertLock[] {
    return Array.from(this.locks.values());
  }

  /**
   * Clear all locks (for testing or reset).
   */
  clear(): void {
    this.locks.clear();
    this.sectionModificationCounts.clear();
  }
}

/**
 * Generate a jitter signal for the defender prompt.
 * Per FR6: Rotates between prioritizing clarity or completeness.
 */
export function getJitterSignal(): string {
  const signals = [
    'For this round, prioritize clarity over completeness when evaluating feedback.',
    'For this round, prioritize completeness over clarity when evaluating feedback.',
  ];
  return signals[Math.floor(Math.random() * signals.length)];
}
