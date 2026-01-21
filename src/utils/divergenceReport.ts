// ============================================================================
// Divergence Report Generator - Consensus failure reporting (PRD v3.0)
// ============================================================================

import type {
  DivergenceReport,
  UnresolvedSection,
  CriticPosition,
  ClaudeAssessment,
  EscalationOptions,
  ChangeEntry,
  CriticModel,
} from '../types/index.js';
import { logger } from './logger.js';

interface DivergenceContext {
  finalPrd: string;
  changelog: ChangeEntry[];
  chatgptFinalCritique?: string;
  geminiFinalCritique?: string;
  roundsCompleted: number;
  totalIssuesRaised: number;
  issuesResolved: number;
}

/**
 * Generate divergence report when consensus fails
 */
export function generateDivergenceReport(
  context: DivergenceContext
): DivergenceReport & { escalationOptions: EscalationOptions } {
  logger.logInfo('Generating divergence report', {
    rounds: context.roundsCompleted,
    totalIssues: context.totalIssuesRaised,
    resolved: context.issuesResolved,
  });

  // Extract unresolved sections from final critiques
  const unresolvedSections = extractUnresolvedSections(
    context.finalPrd,
    context.chatgptFinalCritique,
    context.geminiFinalCritique,
    context.changelog
  );

  // Calculate metrics
  const convergenceRate =
    context.totalIssuesRaised > 0
      ? context.issuesResolved / context.totalIssuesRaised
      : 0;

  const avgIssuesPerRound =
    context.roundsCompleted > 0
      ? context.totalIssuesRaised / context.roundsCompleted
      : 0;

  // Determine recommended action
  const recommendedAction = determineRecommendedAction(
    unresolvedSections,
    convergenceRate
  );

  const report: DivergenceReport = {
    format: 'structured_json',
    reportVersion: '1.0',
    unresolvedSections,
    recommendedAction,
    totalUnresolvedIssues: unresolvedSections.length,
    metricsSummary: {
      roundsCompleted: context.roundsCompleted,
      convergenceRate,
      avgIssuesPerRound,
    },
  };

  // Generate escalation options
  const escalationOptions = generateEscalationOptions(
    unresolvedSections,
    context.finalPrd
  );

  logger.logInfo('Divergence report generated', {
    unresolvedSections: unresolvedSections.length,
    convergenceRate: Math.round(convergenceRate * 100) + '%',
  });

  return { ...report, escalationOptions };
}

/**
 * Extract unresolved sections from final critiques
 */
function extractUnresolvedSections(
  prd: string,
  chatgptCritique?: string,
  geminiCritique?: string,
  changelog?: ChangeEntry[]
): UnresolvedSection[] {
  const sections: UnresolvedSection[] = [];

  // Parse PRD to get section line numbers
  const prdLines = prd.split('\n');
  const sectionMap = buildSectionLineMap(prdLines);

  // Extract issues from critiques
  const chatgptIssues = chatgptCritique
    ? extractIssuesFromCritique(chatgptCritique)
    : [];
  const geminiIssues = geminiCritique
    ? extractIssuesFromCritique(geminiCritique)
    : [];

  // Find sections with unresolved conflicts
  const allSections = new Set([
    ...chatgptIssues.map(i => i.section),
    ...geminiIssues.map(i => i.section),
  ]);

  for (const sectionName of allSections) {
    if (!sectionName) continue;

    const chatgptIssue = chatgptIssues.find(i => i.section === sectionName);
    const geminiIssue = geminiIssues.find(i => i.section === sectionName);

    // Find when this issue was first raised
    const firstRaised = findFirstRaiseRound(sectionName, changelog || []);

    const lineNumbers = sectionMap.get(sectionName) || [0, 0];

    sections.push({
      section: sectionName,
      sectionLineNumbers: lineNumbers as [number, number],
      chatgptPosition: chatgptIssue?.position,
      geminiPosition: geminiIssue?.position,
      claudeAssessment: generateClaudeAssessment(
        sectionName,
        chatgptIssue,
        geminiIssue
      ),
      impactedRequirements: extractImpactedRequirements(sectionName, prd),
      roundFirstRaised: firstRaised,
    });
  }

  return sections;
}

/**
 * Build map of section names to line number ranges
 */
function buildSectionLineMap(lines: string[]): Map<string, [number, number]> {
  const map = new Map<string, [number, number]>();
  let currentSection: string | null = null;
  let sectionStart = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const headerMatch = line.match(/^(#+)\s+(.+)/);

    if (headerMatch) {
      // End previous section
      if (currentSection) {
        map.set(currentSection, [sectionStart, i - 1]);
      }

      // Start new section
      currentSection = headerMatch[2].trim();
      sectionStart = i;
    }
  }

  // End final section
  if (currentSection) {
    map.set(currentSection, [sectionStart, lines.length - 1]);
  }

  return map;
}

/**
 * Extract issues from a critique response
 */
function extractIssuesFromCritique(
  critique: string
): Array<{ section: string; issue: string; position: CriticPosition }> {
  const issues: Array<{
    section: string;
    issue: string;
    position: CriticPosition;
  }> = [];

  const lines = critique.split('\n');
  let currentSection = '';
  let currentIssue = '';

  for (const line of lines) {
    // Section header
    const headerMatch = line.match(/^#+\s+(.+)/);
    if (headerMatch) {
      currentSection = headerMatch[1].trim();
      continue;
    }

    // Issue bullet
    const issueMatch = line.match(/^[\s]*[-*•]\s+(.+)/);
    if (issueMatch && currentSection) {
      currentIssue = issueMatch[1].trim();

      // Extract confidence if mentioned
      const confidenceLower = critique.toLowerCase();
      const confidence: CriticPosition['confidence'] = confidenceLower.includes(
        'high confidence'
      )
        ? 'high'
        : confidenceLower.includes('low confidence')
          ? 'low'
          : 'medium';

      issues.push({
        section: currentSection,
        issue: currentIssue,
        position: {
          summary: currentIssue,
          rationale: currentIssue, // Could be extracted from next lines
          confidence,
        },
      });
    }
  }

  return issues;
}

/**
 * Find the round when an issue was first raised
 */
function findFirstRaiseRound(section: string, changelog: ChangeEntry[]): number {
  for (const change of changelog) {
    if (change.section === section) {
      return change.round;
    }
  }
  return 1;
}

/**
 * Extract impacted requirements from section
 */
function extractImpactedRequirements(section: string, prd: string): string[] {
  // Look for requirement IDs like FR1, NFR2, etc.
  const reqPattern = /\b(FR|NFR|BR|TR)\d+\b/g;
  const matches = prd.match(reqPattern);

  if (!matches) {
    return [];
  }

  return Array.from(new Set(matches));
}

/**
 * Generate Claude's assessment of the conflict
 */
function generateClaudeAssessment(
  section: string,
  chatgptIssue?: { issue: string; position: CriticPosition },
  geminiIssue?: { issue: string; position: CriticPosition }
): ClaudeAssessment {
  if (chatgptIssue && geminiIssue) {
    return {
      summary: `Both critics disagree on ${section}`,
      recommendation: 'Clarify requirements before proceeding',
      blockingSeverity: 'high',
    };
  }

  if (chatgptIssue) {
    return {
      summary: `ChatGPT has concerns about ${section}`,
      recommendation: 'Address ChatGPT concerns or justify current approach',
      blockingSeverity: 'medium',
    };
  }

  if (geminiIssue) {
    return {
      summary: `Gemini has concerns about ${section}`,
      recommendation: 'Address Gemini concerns or justify current approach',
      blockingSeverity: 'medium',
    };
  }

  return {
    summary: `Unresolved issue in ${section}`,
    recommendation: 'Review section for clarity',
    blockingSeverity: 'low',
  };
}

/**
 * Determine recommended action based on unresolved sections
 */
function determineRecommendedAction(
  unresolvedSections: UnresolvedSection[],
  convergenceRate: number
): string {
  if (unresolvedSections.length === 0) {
    return 'Accept best effort PRD - no specific unresolved sections identified';
  }

  const highSeverity = unresolvedSections.filter(
    s => s.claudeAssessment.blockingSeverity === 'high'
  ).length;

  if (highSeverity > 0) {
    return `Manual resolution required for ${highSeverity} high-severity conflicts`;
  }

  if (convergenceRate < 0.5) {
    return 'Low convergence rate - consider restructuring PRD or clarifying scope';
  }

  return 'Targeted re-debate recommended for specific sections';
}

/**
 * Generate escalation options with cost calculations
 */
function generateEscalationOptions(
  unresolvedSections: UnresolvedSection[],
  prd: string
): EscalationOptions {
  const highSeverity = unresolvedSections.filter(
    s => s.claudeAssessment.blockingSeverity === 'high'
  ).length;

  // Calculate section sizes for cost estimation
  const sectionSizes = unresolvedSections.map(section => {
    const lines = prd.split('\n');
    const [start, end] = section.sectionLineNumbers;
    const sectionText = lines.slice(start, end + 1).join('\n');
    return Math.ceil(sectionText.length / 4); // Rough token estimate
  });

  const totalTokens = sectionSizes.reduce((a, b) => a + b, 0);
  const additionalRounds = 3;
  const modelsInvolved = 2; // ChatGPT + Gemini

  // Cost calculation (per IMPLEMENTATION_DECISIONS_v3.0.md)
  const estimatedTokens =
    additionalRounds * modelsInvolved * (totalTokens + 800);
  const chatgptCost = (estimatedTokens / 1000) * 0.005;
  const geminiCost = (estimatedTokens / 1000) * 0.0035;
  const totalCost = (chatgptCost + geminiCost) * 1.2; // 20% buffer

  return {
    acceptBestEffort: {
      action: 'Use Claude\'s final version',
      riskLevel: highSeverity > 0 ? 'high' : 'medium',
      rationale:
        highSeverity > 0
          ? 'Unresolved high-severity issues may cause implementation delays'
          : 'Minor unresolved issues - implementation can proceed with caution',
    },
    manualResolve: {
      action: 'Review divergence report and resubmit with clarifications',
      estimatedTime: '15-30 minutes',
      guidedQuestions: unresolvedSections.map(
        s => `How should ${s.section} be implemented? ${s.claudeAssessment.recommendation}`
      ),
    },
    targetedRedebate: {
      action: 'Extend rounds for specific sections only',
      sections: unresolvedSections.map(s => s.section),
      additionalRounds,
      estimatedCost: `$${totalCost.toFixed(2)}`,
      costBreakdown: {
        calculation: `${unresolvedSections.length} sections (~${totalTokens} tokens). ${additionalRounds} rounds * ${modelsInvolved} models * (${totalTokens} input + 800 avg response) = ${estimatedTokens} tokens`,
        chatgptCost: `$${chatgptCost.toFixed(4)} (${estimatedTokens} tokens * $0.005/1k)`,
        geminiCost: `$${geminiCost.toFixed(4)} (${estimatedTokens} tokens * $0.0035/1k)`,
        totalEstimate: `$${totalCost.toFixed(2)} (includes 20% buffer for variance)`,
      },
      estimatedTime: '2-3 minutes',
      completeExample: {
        description:
          'To run a targeted re-debate, call run_prd_gauntlet with the following complete configuration:',
        code: `run_prd_gauntlet({
  prdContent: \`<insert full PRD markdown from refinedPrd>\`,
  targetedSections: ${JSON.stringify(unresolvedSections.map(s => s.section), null, 2)},
  maxRoundsPerModel: ${additionalRounds},
  includeTranscripts: true,
  transcriptSummaryOnly: false,
  maxEstimatedCost: ${(totalCost + 0.5).toFixed(2)}  // Original cap + targeted re-debate cost
})`,
        notes: [
          'You MUST include the full PRD content from the previous run',
          'targetedSections uses the exact section names from unresolvedSections',
          'The system will ONLY re-debate the specified sections, treating others as frozen',
          'All other configuration parameters (models, timeouts, etc.) can be customized as needed',
        ],
      },
    },
  };
}
