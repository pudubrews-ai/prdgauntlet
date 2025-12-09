import { describe, it, expect } from 'vitest';
import {
  parseDefenderResponse,
  extractDefenderQuestion,
  isRequestingClarification,
} from '../../src/debate/parser.js';

describe('parseDefenderResponse', () => {
  describe('consensus detection', () => {
    it('should detect CONSENSUS_REACHED signal', () => {
      const result = parseDefenderResponse('CONSENSUS_REACHED');
      expect(result.isConsensusReached).toBe(true);
      expect(result.updatedPrd).toBeNull();
      expect(result.roundDelta).toBeNull();
    });

    it('should detect CONSENSUS_REACHED at end of response', () => {
      const result = parseDefenderResponse(
        'Thank you for the approval!\n\nCONSENSUS_REACHED'
      );
      expect(result.isConsensusReached).toBe(true);
    });
  });

  describe('structured response parsing', () => {
    it('should extract PRD and round delta from proper format', () => {
      const response = `---BEGIN RESPONSE---
## Updated PRD
# My PRD

This is the updated PRD content.

## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "Clarified scope section",
  "section": "FR1 > Scope"
}
\`\`\`

## Question for Critic
Do you have any remaining concerns?
---END RESPONSE---`;

      const result = parseDefenderResponse(response);
      expect(result.isConsensusReached).toBe(false);
      expect(result.updatedPrd).toContain('This is the updated PRD content');
      expect(result.roundDelta).toEqual({
        type: 'modification',
        summary: 'Clarified scope section',
        section: 'FR1 > Scope',
      });
    });

    it('should handle response without end marker', () => {
      const response = `---BEGIN RESPONSE---
## Updated PRD
# PRD Content Here

## Changes This Round
\`\`\`json
{
  "type": "addition",
  "summary": "Added new requirement"
}
\`\`\`

## Question for Critic
Any other feedback?`;

      const result = parseDefenderResponse(response);
      expect(result.updatedPrd).toContain('PRD Content Here');
      expect(result.roundDelta?.type).toBe('addition');
    });
  });

  describe('round delta parsing', () => {
    it('should parse all change types', () => {
      const types = ['addition', 'modification', 'deletion', 'revert'];

      for (const type of types) {
        const response = `
## Changes This Round
\`\`\`json
{
  "type": "${type}",
  "summary": "Test change"
}
\`\`\`
`;
        const result = parseDefenderResponse(response);
        expect(result.roundDelta?.type).toBe(type);
      }
    });

    it('should handle missing section field', () => {
      const response = `
## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "General update"
}
\`\`\`
`;
      const result = parseDefenderResponse(response);
      expect(result.roundDelta?.section).toBeUndefined();
    });

    it('should reject invalid change type', () => {
      const response = `
## Changes This Round
\`\`\`json
{
  "type": "invalid",
  "summary": "Bad type"
}
\`\`\`
`;
      const result = parseDefenderResponse(response);
      expect(result.roundDelta).toBeNull();
    });
  });

  describe('error handling', () => {
    it('should handle malformed JSON', () => {
      const response = `
## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "Missing closing brace"
\`\`\`
`;
      const result = parseDefenderResponse(response);
      expect(result.roundDelta).toBeNull();
    });

    it('should set parseError for unparseable response', () => {
      const response = 'This is just random text with no structure';
      const result = parseDefenderResponse(response);
      expect(result.parseError).toBeDefined();
    });
  });
});

describe('extractDefenderQuestion', () => {
  it('should extract question from response', () => {
    const response = `
## Updated PRD
Content here

## Question for Critic
Do you have any remaining concerns with this PRD?
---END RESPONSE---`;

    const question = extractDefenderQuestion(response);
    expect(question).toBe('Do you have any remaining concerns with this PRD?');
  });

  it('should return null if no question section', () => {
    const response = '## Updated PRD\nContent only';
    const question = extractDefenderQuestion(response);
    expect(question).toBeNull();
  });
});

describe('isRequestingClarification', () => {
  it('should detect clarification requests', () => {
    expect(isRequestingClarification("I couldn't parse your response")).toBe(
      true
    );
    expect(
      isRequestingClarification('Please restate your feedback')
    ).toBe(true);
    expect(
      isRequestingClarification('Could you clarify your concerns?')
    ).toBe(true);
  });

  it('should not flag normal responses', () => {
    expect(
      isRequestingClarification('I have updated the PRD based on your feedback')
    ).toBe(false);
  });
});
