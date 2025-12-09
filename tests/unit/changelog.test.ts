import { describe, it, expect, beforeEach } from 'vitest';
import { ChangelogManager } from '../../src/utils/changelog.js';

describe('ChangelogManager', () => {
  let manager: ChangelogManager;

  beforeEach(() => {
    manager = new ChangelogManager();
  });

  describe('addChange', () => {
    it('should add change entry with auto-incrementing version', () => {
      const entry1 = manager.addChange(
        { type: 'addition', summary: 'Added feature X' },
        'chatgpt',
        1
      );

      const entry2 = manager.addChange(
        { type: 'modification', summary: 'Updated feature Y' },
        'gemini',
        1
      );

      expect(entry1.version).toBe(1);
      expect(entry2.version).toBe(2);
    });

    it('should include all fields in entry', () => {
      const entry = manager.addChange(
        {
          type: 'modification',
          summary: 'Updated error handling',
          section: 'FR3 > Error Handling',
        },
        'chatgpt',
        2
      );

      expect(entry).toEqual({
        version: 1,
        source: 'chatgpt',
        round: 2,
        type: 'modification',
        summary: 'Updated error handling',
        section: 'FR3 > Error Handling',
      });
    });

    it('should handle optional section field', () => {
      const entry = manager.addChange(
        { type: 'addition', summary: 'General update' },
        'gemini',
        1
      );

      expect(entry.section).toBeUndefined();
    });
  });

  describe('addRevert', () => {
    it('should create revert entry referencing original', () => {
      manager.addChange(
        { type: 'modification', summary: 'Original change', section: 'FR1' },
        'chatgpt',
        1
      );

      const revert = manager.addRevert(
        1,
        'gemini',
        2,
        'Change was incorrect'
      );

      expect(revert.type).toBe('revert');
      expect(revert.revertedChange).toBe(1);
      expect(revert.summary).toContain('Reverted v1');
      expect(revert.section).toBe('FR1');
    });

    it('should throw if reverting non-existent version', () => {
      expect(() => manager.addRevert(999, 'gemini', 1, 'Bad')).toThrow(
        'Cannot revert: version 999 not found'
      );
    });
  });

  describe('getChangelog', () => {
    it('should return copy of all entries', () => {
      manager.addChange({ type: 'addition', summary: 'A' }, 'chatgpt', 1);
      manager.addChange({ type: 'modification', summary: 'B' }, 'gemini', 1);

      const changelog = manager.getChangelog();
      expect(changelog).toHaveLength(2);

      // Verify it's a copy
      changelog.push({
        version: 99,
        source: 'chatgpt',
        round: 1,
        type: 'addition',
        summary: 'Fake',
      });
      expect(manager.getChangelog()).toHaveLength(2);
    });
  });

  describe('getKeyChanges', () => {
    it('should return array of summaries', () => {
      manager.addChange({ type: 'addition', summary: 'Added X' }, 'chatgpt', 1);
      manager.addChange({ type: 'modification', summary: 'Updated Y' }, 'gemini', 1);

      const keyChanges = manager.getKeyChanges();
      expect(keyChanges).toEqual(['Added X', 'Updated Y']);
    });
  });

  describe('getChangesBySource', () => {
    it('should filter changes by source', () => {
      manager.addChange({ type: 'addition', summary: 'A' }, 'chatgpt', 1);
      manager.addChange({ type: 'modification', summary: 'B' }, 'gemini', 1);
      manager.addChange({ type: 'deletion', summary: 'C' }, 'chatgpt', 2);

      const chatgptChanges = manager.getChangesBySource('chatgpt');
      expect(chatgptChanges).toHaveLength(2);
      expect(chatgptChanges.map((c) => c.summary)).toEqual(['A', 'C']);
    });
  });

  describe('getCurrentVersion', () => {
    it('should track current version', () => {
      expect(manager.getCurrentVersion()).toBe(0);

      manager.addChange({ type: 'addition', summary: 'A' }, 'chatgpt', 1);
      expect(manager.getCurrentVersion()).toBe(1);

      manager.addChange({ type: 'modification', summary: 'B' }, 'gemini', 1);
      expect(manager.getCurrentVersion()).toBe(2);
    });
  });

  describe('getChangelogSummary', () => {
    it('should return formatted summary', () => {
      manager.addChange(
        { type: 'addition', summary: 'Added feature', section: 'FR1' },
        'chatgpt',
        1
      );

      const summary = manager.getChangelogSummary();
      expect(summary).toContain('## Changelog');
      expect(summary).toContain('v1');
      expect(summary).toContain('chatgpt');
      expect(summary).toContain('Added feature');
      expect(summary).toContain('FR1');
    });

    it('should return "No changes" for empty changelog', () => {
      expect(manager.getChangelogSummary()).toBe('No changes made.');
    });

    it('should use appropriate emoji for change type', () => {
      manager.addChange({ type: 'addition', summary: 'A' }, 'chatgpt', 1);
      manager.addChange({ type: 'modification', summary: 'M' }, 'chatgpt', 2);
      manager.addChange({ type: 'deletion', summary: 'D' }, 'chatgpt', 3);

      const summary = manager.getChangelogSummary();
      expect(summary).toContain('➕');
      expect(summary).toContain('📝');
      expect(summary).toContain('➖');
    });
  });

  describe('reset', () => {
    it('should clear all entries and reset version', () => {
      manager.addChange({ type: 'addition', summary: 'A' }, 'chatgpt', 1);
      manager.addChange({ type: 'modification', summary: 'B' }, 'gemini', 1);

      manager.reset();

      expect(manager.getChangelog()).toHaveLength(0);
      expect(manager.getCurrentVersion()).toBe(0);
    });
  });
});
