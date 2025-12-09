// ============================================================================
// Changelog Manager - Revision tracking (FR7)
// ============================================================================

import type { ChangeEntry, RoundDelta, CriticModel } from '../types/index.js';

export class ChangelogManager {
  private entries: ChangeEntry[] = [];
  private currentVersion = 0;

  addChange(
    delta: RoundDelta,
    source: CriticModel,
    round: number,
    revertedChange?: number
  ): ChangeEntry {
    this.currentVersion++;

    const entry: ChangeEntry = {
      version: this.currentVersion,
      source,
      round,
      type: delta.type,
      summary: delta.summary,
      section: delta.section,
      ...(revertedChange !== undefined && { revertedChange }),
    };

    this.entries.push(entry);
    return entry;
  }

  addRevert(
    originalVersion: number,
    source: CriticModel,
    round: number,
    reason: string
  ): ChangeEntry {
    const originalEntry = this.entries.find((e) => e.version === originalVersion);
    if (!originalEntry) {
      throw new Error(`Cannot revert: version ${originalVersion} not found`);
    }

    return this.addChange(
      {
        type: 'revert',
        summary: `Reverted v${originalVersion}: ${reason}`,
        section: originalEntry.section,
      },
      source,
      round,
      originalVersion
    );
  }

  getChangelog(): ChangeEntry[] {
    return [...this.entries];
  }

  getKeyChanges(): string[] {
    return this.entries.map((e) => e.summary);
  }

  getChangesBySource(source: CriticModel): ChangeEntry[] {
    return this.entries.filter((e) => e.source === source);
  }

  getCurrentVersion(): number {
    return this.currentVersion;
  }

  getChangelogSummary(): string {
    if (this.entries.length === 0) {
      return 'No changes made.';
    }

    const lines: string[] = ['## Changelog'];

    for (const entry of this.entries) {
      const prefix =
        entry.type === 'revert'
          ? '↩️'
          : entry.type === 'addition'
            ? '➕'
            : entry.type === 'deletion'
              ? '➖'
              : '📝';

      const section = entry.section ? ` (${entry.section})` : '';
      lines.push(`- ${prefix} v${entry.version} [${entry.source}]: ${entry.summary}${section}`);
    }

    return lines.join('\n');
  }

  reset(): void {
    this.entries = [];
    this.currentVersion = 0;
  }
}
