// ============================================================================
// Conflict Resolution - Handle cross-critic disputes (FR6)
// ============================================================================

import type { ChangeEntry, CriticModel } from '../types/index.js';

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
