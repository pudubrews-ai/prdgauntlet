import { describe, it, expect } from 'vitest';
import { parseSpecReviewResponse } from '../../src/debate/specReviewParser.js';
import type { SpecReviewDelimiters } from '../../src/debate/specReviewParser.js';

const makeDelimiters = (nonce: string): SpecReviewDelimiters => ({
  appSpecStart: `===${nonce}_APP_SPEC_SECTION_START===`,
  appSpecEnd: `===${nonce}_APP_SPEC_SECTION_END===`,
  testSpecStart: `===${nonce}_TEST_SPEC_START===`,
  testSpecEnd: `===${nonce}_TEST_SPEC_END===`,
});

describe('parseSpecReviewResponse', () => {
  const delimiters = makeDelimiters('abc123xyz012');

  it('parses both documents with correct delimiters', () => {
    const response = `
${delimiters.appSpecStart}
# App Spec Section
## Overview
This is the app spec.

## Requirements
- Feature A: required
${delimiters.appSpecEnd}

${delimiters.testSpecStart}
# Test Spec
## Tests
- test: verify Feature A
${delimiters.testSpecEnd}
`;

    const result = parseSpecReviewResponse(response, delimiters);
    expect(result.parseError).toBeUndefined();
    expect(result.updatedAppSpecSection).toContain('# App Spec Section');
    expect(result.updatedTestSpec).toContain('# Test Spec');
  });

  it('returns parseError when no delimiters found and falls back to heuristic', () => {
    const response = `# App Spec Section
Some app spec content here with details.

# Test Spec Section
Some test content here with test cases.`;

    const result = parseSpecReviewResponse(response, delimiters);
    // Should use heuristic fallback and set parseError
    expect(result.parseError).toBeDefined();
  });

  it('returns parseError when only app spec delimiter found', () => {
    const response = `
${delimiters.appSpecStart}
# App Spec
Content here.
${delimiters.appSpecEnd}

No test spec delimiters here.
`;

    const result = parseSpecReviewResponse(response, delimiters);
    expect(result.parseError).toContain('test spec');
    expect(result.updatedAppSpecSection).toContain('# App Spec');
    expect(result.updatedTestSpec).toBe('');
  });

  it('returns parseError when only test spec delimiter found', () => {
    const response = `
No app spec delimiters here.

${delimiters.testSpecStart}
# Test Spec
Content here.
${delimiters.testSpecEnd}
`;

    const result = parseSpecReviewResponse(response, delimiters);
    expect(result.parseError).toContain('app spec');
    expect(result.updatedTestSpec).toContain('# Test Spec');
    expect(result.updatedAppSpecSection).toBe('');
  });

  it('returns parseError with empty content in both documents', () => {
    const response = `
${delimiters.appSpecStart}
${delimiters.appSpecEnd}
${delimiters.testSpecStart}
${delimiters.testSpecEnd}
`;

    const result = parseSpecReviewResponse(response, delimiters);
    expect(result.parseError).toBeDefined();
    expect(result.updatedAppSpecSection).toBe('');
    expect(result.updatedTestSpec).toBe('');
  });

  it('handles delimiter collision — static delimiter in doc does not interfere with UUID delimiters', () => {
    // S-7: A document containing static text like "===APP_SPEC_SECTION_START===" should not
    // confuse the parser since the UUID-prefixed delimiters are unique
    const staticDelimiters = makeDelimiters('static000000');
    const response = `
${delimiters.appSpecStart}
# App Spec
This doc mentions ===static000000_APP_SPEC_SECTION_START=== which is another job's delimiter.
But it should not confuse THIS parser.
${delimiters.appSpecEnd}

${delimiters.testSpecStart}
# Test Spec
Tests here.
${delimiters.testSpecEnd}
`;

    const result = parseSpecReviewResponse(response, delimiters);
    // The correct delimiters still work
    expect(result.parseError).toBeUndefined();
    expect(result.updatedAppSpecSection).toContain('# App Spec');
    expect(result.updatedTestSpec).toContain('# Test Spec');
  });

  it('handles delimiter collision — classic static delimiter in doc does not trigger with UUID nonce', () => {
    // A document with "===APP_SPEC_SECTION_START===" (no nonce) won't match UUID-prefixed delimiters
    const response = `
${delimiters.appSpecStart}
# App Spec
Content: ===APP_SPEC_SECTION_START=== is just text here.
${delimiters.appSpecEnd}

${delimiters.testSpecStart}
# Test Spec
Tests: ===TEST_SPEC_START=== is just text here.
${delimiters.testSpecEnd}
`;

    const result = parseSpecReviewResponse(response, delimiters);
    expect(result.parseError).toBeUndefined();
    expect(result.updatedAppSpecSection).toContain('# App Spec');
    expect(result.updatedTestSpec).toContain('# Test Spec');
  });

  it('trims whitespace from extracted content', () => {
    const response = `
${delimiters.appSpecStart}

  # App Spec

${delimiters.appSpecEnd}

${delimiters.testSpecStart}

  # Test Spec

${delimiters.testSpecEnd}
`;

    const result = parseSpecReviewResponse(response, delimiters);
    expect(result.updatedAppSpecSection).toBe('# App Spec');
    expect(result.updatedTestSpec).toBe('# Test Spec');
  });

  it('returns parseError describing the failure when completely unable to parse', () => {
    const response = 'This response has no delimiters and no recognizable structure.';

    const result = parseSpecReviewResponse(response, delimiters);
    expect(result.parseError).toBeDefined();
    expect(result.parseError!.length).toBeGreaterThan(10);
  });

  it('does not throw on empty response', () => {
    const result = parseSpecReviewResponse('', delimiters);
    expect(result.parseError).toBeDefined();
    expect(result.updatedAppSpecSection).toBe('');
    expect(result.updatedTestSpec).toBe('');
  });

  it('extracts content containing newlines and special characters', () => {
    const response = `
${delimiters.appSpecStart}
# App Spec
## Section 1
Content with special chars: &, <, >, "quotes", \`backticks\`
\`\`\`typescript
function example(): string {
  return "hello";
}
\`\`\`
${delimiters.appSpecEnd}

${delimiters.testSpecStart}
# Test Spec
## Tests
\`\`\`
it('should work', () => {
  expect(example()).toBe("hello");
});
\`\`\`
${delimiters.testSpecEnd}
`;

    const result = parseSpecReviewResponse(response, delimiters);
    expect(result.parseError).toBeUndefined();
    expect(result.updatedAppSpecSection).toContain('function example');
    expect(result.updatedTestSpec).toContain("it('should work'");
  });
});
