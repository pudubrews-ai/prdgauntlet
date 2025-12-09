import { describe, it, expect } from 'vitest';
import {
  detectConsensus,
  isMalformedResponse,
  extractUnresolvedConcerns,
} from '../../src/debate/consensus.js';

describe('detectConsensus', () => {
  describe('exact phrase matching', () => {
    it('should detect exact approval phrase', () => {
      const result = detectConsensus('No further concerns. PRD approved.');
      expect(result.isConsensus).toBe(true);
      expect(result.isConditional).toBe(false);
      expect(result.isMalformed).toBe(false);
    });

    it('should detect approval phrase within text', () => {
      const result = detectConsensus(
        'After reviewing the changes, I have no further concerns. No further concerns. PRD approved.'
      );
      expect(result.isConsensus).toBe(true);
    });

    it('should not match partial approval phrase', () => {
      const result = detectConsensus('No further concerns.');
      expect(result.isConsensus).toBe(false);
    });

    it('should not match modified approval phrase', () => {
      const result = detectConsensus('No more concerns. PRD approved.');
      expect(result.isConsensus).toBe(false);
    });
  });

  describe('structured JSON approval', () => {
    it('should detect valid JSON approval', () => {
      const response = `
\`\`\`json
{
  "approved": true,
  "remainingConcerns": []
}
\`\`\`
`;
      const result = detectConsensus(response);
      expect(result.isConsensus).toBe(true);
      expect(result.isConditional).toBe(false);
    });

    it('should detect conditional approval with concerns', () => {
      const response = `
\`\`\`json
{
  "approved": true,
  "remainingConcerns": ["Need to add error handling"]
}
\`\`\`
`;
      const result = detectConsensus(response);
      expect(result.isConsensus).toBe(false);
      expect(result.isConditional).toBe(true);
      expect(result.condition).toBe('Need to add error handling');
    });

    it('should handle approved=false', () => {
      const response = `
{
  "approved": false,
  "remainingConcerns": ["Major issues remain"]
}
`;
      const result = detectConsensus(response);
      expect(result.isConsensus).toBe(false);
      expect(result.isConditional).toBe(false);
    });

    it('should handle invalid JSON schema', () => {
      const response = `
{
  "approved": "yes",
  "remainingConcerns": []
}
`;
      const result = detectConsensus(response);
      expect(result.isConsensus).toBe(false);
    });
  });

  describe('conditional approval patterns', () => {
    it('should detect "approved if" pattern', () => {
      const result = detectConsensus('Approved if you add input validation');
      expect(result.isConsensus).toBe(false);
      expect(result.isConditional).toBe(true);
      expect(result.condition).toBe('you add input validation');
    });

    it('should detect "LGTM if" pattern', () => {
      const result = detectConsensus('LGTM if you fix the typo in FR3');
      expect(result.isConsensus).toBe(false);
      expect(result.isConditional).toBe(true);
    });

    it('should detect "will approve once" pattern', () => {
      const result = detectConsensus(
        'I will approve once the edge cases are addressed'
      );
      expect(result.isConsensus).toBe(false);
      expect(result.isConditional).toBe(true);
    });
  });

  describe('regular feedback', () => {
    it('should not flag regular feedback as consensus or conditional', () => {
      const result = detectConsensus(
        'I have several concerns about this PRD:\n1. Missing error handling\n2. Unclear scope'
      );
      expect(result.isConsensus).toBe(false);
      expect(result.isConditional).toBe(false);
      expect(result.isMalformed).toBe(false);
    });
  });
});

describe('isMalformedResponse', () => {
  it('should flag empty response', () => {
    expect(isMalformedResponse('')).toBe(true);
  });

  it('should flag very short response', () => {
    expect(isMalformedResponse('ok')).toBe(true);
  });

  it('should not flag normal response', () => {
    expect(
      isMalformedResponse(
        'I have reviewed the PRD and have the following feedback: The scope section is too vague.'
      )
    ).toBe(false);
  });

  it('should flag response with high non-printable character ratio', () => {
    const garbled = 'test' + '\x00'.repeat(50) + 'test';
    expect(isMalformedResponse(garbled)).toBe(true);
  });
});

describe('extractUnresolvedConcerns', () => {
  it('should extract concerns from bullet list', () => {
    const response = `
I have the following concerns:
- Need better error handling
- Missing validation for user input
- Performance considerations not addressed
`;
    const concerns = extractUnresolvedConcerns(response);
    expect(concerns).toHaveLength(3);
    expect(concerns).toContain('Need better error handling');
  });

  it('should extract concerns from numbered list', () => {
    const response = `
Outstanding issues:
1. Security section needs work
2. No mention of rate limiting
`;
    const concerns = extractUnresolvedConcerns(response);
    expect(concerns.length).toBeGreaterThan(0);
  });

  it('should extract from structured JSON', () => {
    const response = `
{
  "approved": true,
  "remainingConcerns": ["Add tests", "Update docs"]
}
`;
    const concerns = extractUnresolvedConcerns(response);
    expect(concerns).toEqual(['Add tests', 'Update docs']);
  });

  it('should return empty array for approval', () => {
    const concerns = extractUnresolvedConcerns(
      'No further concerns. PRD approved.'
    );
    expect(concerns).toHaveLength(0);
  });
});
