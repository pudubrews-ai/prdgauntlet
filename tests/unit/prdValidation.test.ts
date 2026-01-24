// ============================================================================
// PRD Validation Test - Verify completeness checking works correctly
// ============================================================================

import { describe, it, expect } from 'vitest';
import { validatePrdCompleteness, formatValidationError } from '../../src/utils/prdValidation.js';

describe('PRD Validation', () => {
  describe('Valid PRDs', () => {
    it('should pass validation for complete PRD', () => {
      const prd = `# Product Requirements Document

## Product Overview
This is a complete product description.

## Problem Statement
The problem we're solving is clear.

## Functional Requirements
- FR1: User authentication
- FR2: Data storage

## Success Criteria
- All features implemented
- Tests passing
`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(result.diagnostics.endsCleanly).toBe(true);
      expect(result.diagnostics.hasValidMarkdown).toBe(true);
      expect(result.diagnostics.hasMinimumSections).toBe(true);
    });

    it('should pass for PRD ending with code block', () => {
      const prd = `# PRD

## Product Overview
Complete overview.

## Functional Requirements
Example code:

\`\`\`typescript
function example() {
  return true;
}
\`\`\`
`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(true);
      expect(result.diagnostics.endsCleanly).toBe(true);
    });

    it('should pass for simple PRD with basic structure', () => {
      const prd = `# PRD

## Overview
Brief overview here.
`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(true);
    });
  });

  describe('Incomplete PRDs - Code truncation', () => {
    it('should detect incomplete for loop (real failure case)', () => {
      const prd = `# PRD

## Test Generation
Generate tests with this algorithm:

\`\`\`typescript
for (const error`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('incomplete code'))).toBe(true);
      expect(result.diagnostics.endsCleanly).toBe(false);
    });

    it('should detect incomplete function declaration', () => {
      const prd = `# PRD

## Code
\`\`\`typescript
function test(param`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('incomplete code'))).toBe(true);
    });
  });

  describe('Incomplete PRDs - Markdown structure', () => {
    it('should detect unclosed code block', () => {
      const prd = `# PRD

## Overview
Complete section.

## Code Example
\`\`\`typescript
function test() {
  return true;
}
`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('Unclosed code block'))).toBe(true);
      expect(result.diagnostics.hasValidMarkdown).toBe(false);
    });

    it('should detect orphaned heading at end', () => {
      const prd = `# PRD

## Product Overview
Complete overview here.

## Functional Requirements`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('heading') && i.includes('no content follows'))).toBe(true);
    });

    it('should allow terminal section headings like Appendix', () => {
      const prd = `# PRD

## Product Overview
Complete overview.

## Appendix`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(true);
    });

    it('should detect empty list item at end', () => {
      const prd = `# PRD

## Requirements
- Requirement 1
- Requirement 2
- `;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('empty list item'))).toBe(true);
    });
  });

  describe('Truncation indicators', () => {
    it('should detect trailing ellipsis', () => {
      const prd = `# PRD

## Overview
Complete section...`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('...'))).toBe(true);
      expect(result.diagnostics.truncationIndicators).toContain('trailing ellipsis');
    });

    it('should detect incomplete markdown table', () => {
      const prd = `# PRD

## Comparison

| Feature | Status |
|---------|--------|
| Auth    | Done   |
| Storage | In Progress`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('incomplete markdown table'))).toBe(true);
    });
  });

  describe('Edge cases', () => {
    it('should reject empty PRD', () => {
      const prd = '';

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('empty'))).toBe(true);
    });

    it('should reject PRD with no headings', () => {
      const prd = `This is just plain text without any structure or headings.`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('no markdown headings'))).toBe(true);
    });
  });

  describe('Error formatting', () => {
    it('should format validation errors clearly', () => {
      const prd = `# Incomplete

\`\`\`typescript
for (const error`;

      const result = validatePrdCompleteness(prd);
      const formatted = formatValidationError(result);

      expect(formatted).toContain('PRD validation failed');
      expect(formatted).toContain('Diagnostics');
      expect(formatted).toContain('Ends cleanly: No');
      expect(formatted).toContain('Last 200 characters');
      expect(formatted).toContain('Recommendation');
    });
  });

  describe('Real-world failure case from job 4f268bbd', () => {
    it('should catch the exact truncation pattern from job 4f268bbd', () => {
      const prd = `# PRD v4.0

## Test Generation Algorithm

\`\`\`typescript
function generateIntegrationTests(config: TestGenerationConfig): TestSuite {
  const testSuite = new TestSuite();

  for (const chain of config.integrationChains) {
    const steps = chain.steps;

    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];

      if (step.type === 'UI_ACTION') {
        successTest.addAction(generateUIAction(step, config.testFramework));
      }
    }

    testSuite.addTest(successTest);

    for (const error`;

      const result = validatePrdCompleteness(prd);

      expect(result.isValid).toBe(false);
      expect(result.issues.some(i => i.includes('incomplete code'))).toBe(true);
      expect(result.diagnostics.endsCleanly).toBe(false);
      expect(result.diagnostics.truncationIndicators).toContain('incomplete code');
    });
  });
});
