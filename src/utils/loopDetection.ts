// ============================================================================
// Loop Detection - Detect when critics revert each other's changes (PRD v3.0)
// ============================================================================

import type { IssueLoop, LoopEvent, CriticModel, ChangeEntry } from '../types/index.js';
import { logger } from './logger.js';

/**
 * Issue signature for tracking across rounds
 */
interface IssueSignature {
  hash: string;
  description: string;
  section?: string;
}

/**
 * Loop detector tracks issues across debate rounds
 */
export class LoopDetector {
  private issueHistory: Map<string, LoopEvent[]> = new Map();
  private detectedLoops: IssueLoop[] = [];

  /**
   * Generate a hash for an issue to track it across rounds
   */
  private hashIssue(description: string, section?: string): string {
    const normalized = description
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    const sectionPart = section ? `::${section}` : '';
    return `${normalized}${sectionPart}`;
  }

  /**
   * Extract issue signatures from a critique response
   */
  private extractIssues(critique: string): IssueSignature[] {
    const issues: IssueSignature[] = [];

    // Split by bullet points or numbered lists
    const lines = critique.split('\n');
    let currentSection: string | undefined;

    for (const line of lines) {
      // Track section headers
      const sectionMatch = line.match(/^#+\s+(.+)/);
      if (sectionMatch) {
        currentSection = sectionMatch[1].trim();
        continue;
      }

      // Extract bullet points or numbered items
      const issueMatch = line.match(/^[\s]*[-*•]\s+(.+)|^\d+[.)]\s+(.+)/);
      if (issueMatch) {
        const description = (issueMatch[1] || issueMatch[2]).trim();
        if (description.length > 10) {
          issues.push({
            hash: this.hashIssue(description, currentSection),
            description,
            section: currentSection,
          });
        }
      }
    }

    return issues;
  }

  /**
   * Record an issue being raised by a critic
   */
  recordIssueRaised(
    round: number,
    critic: CriticModel,
    critique: string
  ): void {
    const issues = this.extractIssues(critique);

    for (const issue of issues) {
      const history = this.issueHistory.get(issue.hash) || [];

      // Check if this is a re-raise (was raised, accepted/rejected, now raised again)
      const wasAddressedBefore = history.some(
        event => event.action === 'accepted' || event.action === 'rejected'
      );

      const action: LoopEvent['action'] = wasAddressedBefore ? 'raised_again' : 'raised';

      history.push({ round, critic, action });
      this.issueHistory.set(issue.hash, history);

      logger.logDebug('Issue tracked', {
        round,
        critic,
        action,
        issue: issue.description.substring(0, 50),
      });
    }
  }

  /**
   * Record changes made in response to critique
   */
  recordChanges(
    round: number,
    critic: CriticModel,
    changes: ChangeEntry[]
  ): void {
    for (const change of changes) {
      const issueHash = this.hashIssue(change.summary, change.section);
      const history = this.issueHistory.get(issueHash);

      if (history && history.length > 0) {
        const lastEvent = history[history.length - 1];

        if (lastEvent.action === 'raised' || lastEvent.action === 'raised_again') {
          // Issue was addressed
          const action: LoopEvent['action'] = change.type === 'revert' ? 'rejected' : 'accepted';
          history.push({ round, critic: 'chatgpt' as CriticModel, action }); // Claude is always defender
          this.issueHistory.set(issueHash, history);

          logger.logDebug('Issue addressed', {
            round,
            action,
            issue: change.summary.substring(0, 50),
          });
        }
      }
    }
  }

  /**
   * Detect loops in the issue history
   * Loop pattern: raised → accepted/rejected → raised_again
   */
  detectLoops(currentRound: number): IssueLoop[] {
    const newLoops: IssueLoop[] = [];

    for (const [hash, timeline] of this.issueHistory.entries()) {
      // Need at least 3 events for a loop (raise, accept/reject, raise again)
      if (timeline.length < 3) {
        continue;
      }

      // Check for loop pattern in the timeline
      let wasRaised = false;
      let wasAddressed = false;
      let wasRaisedAgain = false;

      for (const event of timeline) {
        if (event.action === 'raised') {
          wasRaised = true;
        } else if (event.action === 'accepted' || event.action === 'rejected') {
          if (wasRaised) {
            wasAddressed = true;
          }
        } else if (event.action === 'raised_again') {
          if (wasRaised && wasAddressed) {
            wasRaisedAgain = true;
          }
        }
      }

      if (wasRaised && wasAddressed && wasRaisedAgain) {
        // Check if we already detected this loop
        const alreadyDetected = this.detectedLoops.some(
          loop => loop.issue === hash
        );

        if (!alreadyDetected) {
          // Get the issue description from the first event
          const firstEvent = timeline[0];
          const issueDesc = Array.from(this.issueHistory.entries())
            .find(([h]) => h === hash)?.[0] || hash;

          const loop: IssueLoop = {
            issue: issueDesc,
            timeline,
            detectedAtRound: currentRound,
          };

          newLoops.push(loop);
          this.detectedLoops.push(loop);

          logger.logWarn('Loop detected', {
            issue: issueDesc.substring(0, 100),
            rounds: timeline.map(e => e.round),
            detectedAt: currentRound,
          });
        }
      }
    }

    return newLoops;
  }

  /**
   * Get all detected loops
   */
  getDetectedLoops(): IssueLoop[] {
    return this.detectedLoops;
  }

  /**
   * Check if current state indicates a loop (early detection)
   */
  hasActiveLoop(): boolean {
    return this.detectedLoops.length > 0;
  }

  /**
   * Get loop summary for reporting
   */
  getLoopSummary(): string {
    if (this.detectedLoops.length === 0) {
      return 'No loops detected';
    }

    return `${this.detectedLoops.length} loop(s) detected:\n${this.detectedLoops
      .map(
        (loop, i) =>
          `${i + 1}. ${loop.issue.substring(0, 100)}... (detected at round ${loop.detectedAtRound})`
      )
      .join('\n')}`;
  }
}
