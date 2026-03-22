// ============================================================================
// Defender Protocol Validation Test - Ensures defender returns updated PRD
// ============================================================================

import { describe, it, expect } from 'vitest';
import { parseDefenderResponse } from '../../src/debate/parser.js';

describe('Defender Protocol Validation', () => {
  describe('Valid defender responses', () => {
    it('should parse valid response with full PRD', () => {
      const response = `---BEGIN RESPONSE---
## Updated PRD

# Test PRD v1.1

## Overview
This is the updated PRD content with all changes applied.

## Requirements
- Requirement 1
- Requirement 2

## Changes This Round
\`\`\`json
{
  "type": "addition",
  "summary": "Added requirement 2",
  "section": "Requirements"
}
\`\`\`

## Question for Critic
Do you have any remaining concerns with this PRD?
---END RESPONSE---`;

      const parsed = parseDefenderResponse(response);

      expect(parsed.isConsensusReached).toBe(false);
      expect(parsed.updatedPrd).not.toBeNull();
      expect(parsed.updatedPrd).toContain('# Test PRD v1.1');
      expect(parsed.updatedPrd).toContain('Requirement 1');
      expect(parsed.roundDelta).not.toBeNull();
      expect(parsed.roundDelta?.type).toBe('addition');
      expect(parsed.parseError).toBeUndefined();
    });

    it('should parse minimal valid response', () => {
      const response = `---BEGIN RESPONSE---
## Updated PRD
# Simple PRD
Content here.

## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "Updated content"
}
\`\`\`
---END RESPONSE---`;

      const parsed = parseDefenderResponse(response);

      expect(parsed.updatedPrd).not.toBeNull();
      expect(parsed.updatedPrd).toContain('Simple PRD');
      expect(parsed.roundDelta).not.toBeNull();
    });
  });

  describe('Protocol violations - Missing updated PRD', () => {
    it('should detect when only changes are provided without PRD', () => {
      const response = `---BEGIN RESPONSE---
## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "Made some changes",
  "section": "Requirements"
}
\`\`\`

## Question for Critic
Do you have any remaining concerns?
---END RESPONSE---`;

      const parsed = parseDefenderResponse(response);

      // This is the bug we fixed: roundDelta exists but no updatedPrd
      expect(parsed.roundDelta).not.toBeNull();
      expect(parsed.updatedPrd).toBeNull();
      expect(parsed.isConsensusReached).toBe(false);

      // The engine should detect this as a critical error
      // and trigger early_stop (tested in integration test)
    });

    it('should detect when defender provides only a changelog', () => {
      const response = `---BEGIN RESPONSE---
## Full Changelog

**Round 1:**
1. Added terminology section
2. Clarified requirements

**Round 2:**
1. Fixed typo in FR1
2. Updated success criteria

## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "Updated changelog"
}
\`\`\`
---END RESPONSE---`;

      const parsed = parseDefenderResponse(response);

      expect(parsed.roundDelta).not.toBeNull();
      expect(parsed.updatedPrd).toBeNull();

      // This is another form of the bug: changelog without PRD
    });

    it('should detect malformed response asking for clarification', () => {
      const response = `---BEGIN RESPONSE---
## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "No changes - requested clarification from critic",
  "section": "N/A"
}
\`\`\`

## Question for Critic
I couldn't parse your previous response. Could you please restate your feedback?
---END RESPONSE---`;

      const parsed = parseDefenderResponse(response);

      expect(parsed.roundDelta).not.toBeNull();
      expect(parsed.updatedPrd).toBeNull();

      // When defender requests clarification, it may not provide PRD
      // This is acceptable and shouldn't trigger the bug
    });
  });

  describe('Consensus signals', () => {
    it('should detect consensus without needing PRD', () => {
      const response = 'CONSENSUS_REACHED';

      const parsed = parseDefenderResponse(response);

      expect(parsed.isConsensusReached).toBe(true);
      expect(parsed.updatedPrd).toBeNull();
      expect(parsed.roundDelta).toBeNull();
    });

    it('should detect consensus at end of response', () => {
      const response = `---BEGIN RESPONSE---
## Changes This Round
\`\`\`json
{
  "type": "modification",
  "summary": "Final refinements"
}
\`\`\`
---END RESPONSE---
CONSENSUS_REACHED`;

      const parsed = parseDefenderResponse(response);

      expect(parsed.isConsensusReached).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should handle PRD with nested markdown headers', () => {
      const response = `---BEGIN RESPONSE---
## Updated PRD

# Main PRD Title

## Section 1
Content here.

### Subsection 1.1
More content.

## Section 2
Different content.

## Changes This Round
\`\`\`json
{
  "type": "addition",
  "summary": "Added subsection"
}
\`\`\`
---END RESPONSE---`;

      const parsed = parseDefenderResponse(response);

      expect(parsed.updatedPrd).not.toBeNull();
      expect(parsed.updatedPrd).toContain('# Main PRD Title');
      expect(parsed.updatedPrd).toContain('## Section 1');
      expect(parsed.updatedPrd).toContain('### Subsection 1.1');
      expect(parsed.updatedPrd).toContain('## Section 2');
      // Should NOT include the "Changes This Round" section
      expect(parsed.updatedPrd).not.toContain('Changes This Round');
    });

    it('should handle response without markers', () => {
      const response = `## Updated PRD
# Simple Document

## Changes This Round
\`\`\`json
{"type": "modification", "summary": "Updated"}
\`\`\``;

      const parsed = parseDefenderResponse(response);

      expect(parsed.updatedPrd).not.toBeNull();
      expect(parsed.roundDelta).not.toBeNull();
    });
  });
});
