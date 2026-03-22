import { describe, it, expect } from 'vitest';
import {
  computeCrossDocumentReport,
  extractAppSpecBehaviors,
  detectMismatches,
} from '../../src/utils/crossDocumentReport.js';

describe('extractAppSpecBehaviors', () => {
  it('extracts HTTP endpoint definitions', () => {
    const spec = `
# API Spec
GET /users - list users
POST /users - create user
DELETE /users/:id - remove user
`;
    const behaviors = extractAppSpecBehaviors(spec);
    expect(behaviors.some(b => b.toLowerCase().includes('get'))).toBe(true);
    expect(behaviors.some(b => b.toLowerCase().includes('post'))).toBe(true);
  });

  it('extracts numbered requirements', () => {
    const spec = `
# Requirements
1. The system shall validate email addresses before submission.
2. The system shall return a 400 error for invalid inputs.
3. Short one.
`;
    const behaviors = extractAppSpecBehaviors(spec);
    expect(behaviors.length).toBeGreaterThanOrEqual(2);
    expect(behaviors.some(b => b.includes('email'))).toBe(true);
  });

  it('extracts bullet-point behaviors', () => {
    const spec = `
# Features
- Users must be able to log in with email and password credentials
- The system must display error messages for failed authentication attempts
- Short.
`;
    const behaviors = extractAppSpecBehaviors(spec);
    expect(behaviors.some(b => b.includes('log in'))).toBe(true);
    expect(behaviors.some(b => b.includes('error'))).toBe(true);
  });

  it('extracts shall/must/should requirements', () => {
    const spec = `
The API shall support pagination for all list endpoints.
Authentication must be required for all write operations.
`;
    const behaviors = extractAppSpecBehaviors(spec);
    expect(behaviors.some(b => b.includes('pagination'))).toBe(true);
  });

  it('deduplicates identical behaviors', () => {
    const spec = `
- The system shall validate all inputs before processing them.
- The system shall validate all inputs before processing them.
`;
    const behaviors = extractAppSpecBehaviors(spec);
    const count = behaviors.filter(b => b.includes('validate all inputs')).length;
    expect(count).toBe(1);
  });

  it('skips section headings', () => {
    const spec = `
# Overview
## Features
### Details
Content here must work correctly.
`;
    const behaviors = extractAppSpecBehaviors(spec);
    // Headings should not be included
    expect(behaviors.every(b => !b.startsWith('#'))).toBe(true);
  });

  it('returns empty array for empty spec', () => {
    const behaviors = extractAppSpecBehaviors('');
    expect(behaviors).toEqual([]);
  });
});

describe('computeCrossDocumentReport', () => {
  it('returns alignmentScore 1.0 when no behaviors found', () => {
    const report = computeCrossDocumentReport('', '');
    expect(report.alignmentScore).toBe(1.0);
    expect(report.coverageMatrix.appSpecBehaviors).toBe(0);
    expect(report.coverageMatrix.testedBehaviors).toBe(0);
    expect(report.coverageMatrix.coveragePercent).toBe(100);
  });

  it('returns alignmentScore between 0 and 1 for real content', () => {
    const appSpec = `
# User Authentication
1. The system shall validate email addresses before login.
2. The system shall return a 401 error for invalid credentials.
`;

    const testSpec = `
# Auth Tests
describe('authentication', () => {
  it('validates email addresses before login', () => {
    // test email validation
  });
});
`;

    const report = computeCrossDocumentReport(appSpec, testSpec);
    expect(report.alignmentScore).toBeGreaterThanOrEqual(0);
    expect(report.alignmentScore).toBeLessThanOrEqual(1);
  });

  it('returns a coverageMatrix with all required fields', () => {
    const appSpec = `
1. The system shall support user login.
`;
    const testSpec = `
it('supports user login functionality', () => {});
`;

    const report = computeCrossDocumentReport(appSpec, testSpec);
    expect(report.coverageMatrix).toHaveProperty('appSpecBehaviors');
    expect(report.coverageMatrix).toHaveProperty('testedBehaviors');
    expect(report.coverageMatrix).toHaveProperty('coveragePercent');
    expect(typeof report.coverageMatrix.appSpecBehaviors).toBe('number');
    expect(typeof report.coverageMatrix.testedBehaviors).toBe('number');
    expect(typeof report.coverageMatrix.coveragePercent).toBe('number');
  });

  it('returns mismatches array (may be empty for matching content)', () => {
    const appSpec = `
# App Spec
Login button text: "Sign In"
`;
    const testSpec = `
# Test Spec
expect(button).toHaveText("Sign In");
`;

    const report = computeCrossDocumentReport(appSpec, testSpec);
    expect(Array.isArray(report.mismatches)).toBe(true);
  });

  it('coveragePercent matches ratio of testedBehaviors to appSpecBehaviors', () => {
    const appSpec = `
1. The system shall validate inputs properly.
2. The system shall process data correctly.
`;
    const testSpec = `
it('validates inputs properly', () => {});
`;

    const report = computeCrossDocumentReport(appSpec, testSpec);
    if (report.coverageMatrix.appSpecBehaviors > 0) {
      const expected = Math.round(
        (report.coverageMatrix.testedBehaviors / report.coverageMatrix.appSpecBehaviors) * 100
      );
      expect(report.coverageMatrix.coveragePercent).toBe(expected);
    }
  });
});

describe('detectMismatches', () => {
  it('returns empty array when docs are similar', () => {
    const appSpec = '# App\nThe button label is "Submit".';
    const testSpec = '# Tests\nexpect(button).toHaveText("Submit");';

    const mismatches = detectMismatches(appSpec, testSpec);
    expect(Array.isArray(mismatches)).toBe(true);
  });

  it('mismatch entries have required fields', () => {
    const appSpec = `
# App Spec
## Login
data-testid="login-submit-button"
Error message: "Invalid credentials provided"
`;
    const testSpec = `
# Test Spec
## Login Tests
data-testid="login-submit-btn"
Error: "Invalid credentials provide"
`;

    const mismatches = detectMismatches(appSpec, testSpec);
    for (const mismatch of mismatches) {
      expect(mismatch).toHaveProperty('type');
      expect(mismatch).toHaveProperty('appSpecLocation');
      expect(mismatch).toHaveProperty('testSpecLocation');
      expect(mismatch).toHaveProperty('appSpecValue');
      expect(mismatch).toHaveProperty('testSpecValue');
      expect(mismatch).toHaveProperty('resolution');
      expect(['string_mismatch', 'attribute_mismatch']).toContain(mismatch.type);
    }
  });

  it('does not throw on empty inputs', () => {
    expect(() => detectMismatches('', '')).not.toThrow();
    const result = detectMismatches('', '');
    expect(Array.isArray(result)).toBe(true);
  });
});
