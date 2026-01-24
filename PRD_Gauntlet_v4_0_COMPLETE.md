# PRD: Multi-Model PRD Gauntlet v4.0

## Product Overview
An MCP server that orchestrates multi-model PRD refinement through structured debates between ChatGPT and Gemini critics. Claude facilitates iterative improvement of Product Requirements Documents by having different AI models critique and refine content until consensus is reached. **NEW in v4.0:** Adds integration validation to catch orphaned components in PRD specs, and generates executable test suites to enforce implementation completeness.

## Problem Statement

**The Dual Gap Problem:**

1. **Horizontal Gaps (Solved in v3.0):** Undefined technical terminology causes systematic misunderstandings across all AI participants
   - Example: Three AIs all misinterpret "A2A" as custom protocol instead of Agent2Agent Protocol
   - Solution: Universal Research Protocol requiring web search verification

2. **Vertical Integration Gaps (NEW - Addressed in v4.0):** PRDs specify individual components but fail to document how they connect, leading to orphaned implementations
   - Example: BeanAgent v0.84.1 defined agent mode `reviewImport` and implemented API endpoint, but no UI handler connected them
   - Result: Feature completely non-functional despite "95% test coverage"
   - Root cause: PRD specified components in isolation without integration chains

3. **Implementation Enforcement Gap (NEW - Addressed in v4.0):** Even with complete PRDs, implementations can skip vertical integration
   - Example: AI claims feature is "complete" but only implemented isolated components
   - Result: Components work individually but fail when connected
   - Root cause: No executable tests proving end-to-end functionality

**v4.0 Solution:**
- **Integration Validation:** Static analysis + critic review catches orphaned components in PRD specs
- **Test Generation:** Produces executable test suite requiring vertical integration to pass
- **Enforcement:** Features cannot be marked "complete" until tests pass

## Target User Profile

**Primary User:** Technical Product Managers and Engineering Leads using AI-assisted development

**User Characteristics:**
- Writes PRDs for implementation by AI coding assistants (Claude, Cursor, etc.)
- Has experienced "feature works in isolation but fails when integrated" bugs
- Wants to prevent implementation failures before code is written
- Comfortable reviewing and running test suites (Playwright, Vitest, etc.)
- Makes final decisions on component integration architecture

**Expected Interaction Pattern:**
1. User submits PRD draft
2. Reviews integration validation findings (orphaned components flagged)
3. Approves/modifies integration chains and component definitions
4. Receives refined PRD + generated test suite
5. Hands tests to AI coding assistant or development team
6. Feature cannot be "done" until tests pass

**Not Intended For:**
- Non-technical stakeholders who cannot evaluate integration architectures
- Fully automated PRD generation (system refines, does not create from scratch)
- Projects without test infrastructure (requires test runner setup)

## Technical Prerequisites

**Required Infrastructure:**
- Test runner environment (Node.js 18+ for JS/TS frameworks, Python 3.9+ for pytest)
- Database access for integration tests (test database recommended)
- CI/CD pipeline capable of running automated tests (optional but recommended)

**System Requirements for Static Analysis:**
- Memory: 512MB minimum for PRD parsing (2GB recommended for large PRDs >100KB)
- Disk space: 100MB for temporary analysis artifacts
- Network: Internet access for AI model API calls during test generation

**Known Limitations:**
- Static analysis cannot detect integration chains in dynamically generated component names (e.g., `components[dynamicKey]`)
- Test generation requires structured PRD format (markdown with clear section headers)
- Maximum PRD size: 1MB (hard limit due to LLM context windows)
- Languages supported for test generation: JavaScript, TypeScript, Python (other languages require manual test authoring)

## Terminology & Standards

**Critical Protocol: Unknown Term Research**
All AI participants (Claude, ChatGPT, Gemini) MUST follow this protocol when encountering unfamiliar acronyms or technical terms:

1. **Research First**: Use web search to find official specifications/definitions
2. **Verify with Context**: Present findings and confirm interpretation
3. **Document**: Add verified definitions with source links to this section

**AI Model References:**
- **Claude**: Anthropic's AI assistant (specifically the Claude 3.5 Sonnet model used as the PRD defender in this system) (source: https://www.anthropic.com/claude)
- **ChatGPT**: OpenAI's conversational AI model (GPT-4 or later, used as first critic) (source: https://openai.com/chatgpt)
- **Gemini**: Google DeepMind's multimodal AI model (Gemini 1.5 Pro or later, used as second critic) (source: https://deepmind.google/technologies/gemini/)

**NEW - Integration-Specific Terms:**
- **Integration Chain**: Complete execution path from user input → component A → component B → component C → user output
  - Example: User clicks "Import Beans" button → `handleImport()` function → `POST /api/beans/import` → Database insert → Success toast notification
- **Orphaned Component**: Code element (agent mode, API endpoint, UI handler, database table) defined but not connected to calling or called components
  - Example: API endpoint `/api/labels/generate` exists in PRD but no UI button or function is documented that calls it
- **Vertical Integration**: Connection between layers of the stack (UI → API → Database), as opposed to horizontal integration (API → API)
- **Test Framework**: Tool for writing and executing automated tests
  - Playwright: End-to-end testing for web applications (source: https://playwright.dev/)
  - Vitest: Unit test framework for Vite projects (source: https://vitest.dev/)
  - Jest: JavaScript testing framework (source: https://jestjs.io/)
  - pytest: Python testing framework (source: https://pytest.org/)
- **End-to-End Test**: Test that exercises complete user flow through all system layers
  - Example: Test that starts with button click, verifies API request, checks database change, and asserts UI update
- **Static Analysis**: Automated code/document inspection without execution
  - In this context: Parsing PRD markdown to extract component definitions and detect missing connections
- **Dynamic Component**: UI element or function whose name/reference is computed at runtime rather than statically defined
  - Example: `components[userSelectedMode]` where `userSelectedMode` is a variable
  - Limitation: Static analysis cannot reliably detect integration chains for dynamic components
- **Test Assertion**: Verification statement in test code that checks expected vs. actual behavior
  - Example: `expect(page.locator('.toast-success')).toBeVisible()` verifies success notification appears

**Defined Terms (from v3.0):**
- **PRD**: Product Requirements Document - specification document defining product features, scope, and technical requirements
- **MCP**: Model Context Protocol (Anthropic specification v1.0) - standard for tool/server integration with Claude (source: https://modelcontextprotocol.io/specification)
  - Note: Distinct from "A2A" (Agent2Agent Protocol) - see Appendix for failure case study
- **API**: Application Programming Interface
- **UUID**: Universally Unique Identifier (RFC 4122) - 128-bit identifier format (source: https://www.rfc-editor.org/rfc/rfc4122)
- **Agent Mode**: System prompt output format signaling UI to take specific action (e.g., `{mode: "reviewImport"}`)

**Conflict Resolution for Multiple Standards:**
When research yields multiple authoritative sources:
1. **Prioritization Order**:
   - Official specification bodies (W3C, IETF, ISO)
   - Original creators/maintainers (if identifiable via GitHub/official site)
   - Most recent stable release (not draft/experimental)
   - Most widely adopted (measured by GitHub stars, npm downloads, industry adoption)

2. **Present Options to User**: If multiple valid standards exist, provide comparison and ask for decision
3. **Document Decision**: Update Terminology section with chosen standard, version, source, and rationale

**Research Requirement:**
When any term appears in the PRD that is not defined above, the reviewing AI must:
- Search for official specification: `web_search: "[term] specification"` or `web_search: "[term] protocol standard"`
- Fetch authoritative sources to verify meaning
- Follow conflict resolution protocol if multiple standards found
- Challenge the PRD if term is undefined or ambiguous
- Require addition of verified definition with source link

## Core Functionality

### PRD Refinement Process (Enhanced)

1. User submits initial PRD markdown content
2. **NEW: Pre-debate Static Analysis**
   - Extract component definitions (API endpoints, UI handlers, agent modes, database schemas)
   - Identify potential integration chains based on naming/context
   - Flag orphaned components (defined but no connections found)
   - Present findings to user for confirmation before debate starts
3. System sequentially engages ChatGPT and Gemini as critics
4. Each critic provides substantive critique of the PRD, **now including integration validation**
5. Claude defends and refines the PRD based on critiques
6. Process continues until both critics reach consensus or max rounds exceeded
7. **NEW: Post-consensus Test Generation**
   - Parse refined PRD for acceptance criteria
   - Generate test suite covering identified integration chains
   - Include UI tests, API tests, and vertical slice tests
8. Returns refined PRD + test suite + improvement summary

### Integration Validation (NEW)

**Pre-Debate Static Analysis:**

System parses PRD markdown to extract:
- **API Endpoints**: Pattern match `GET /api/`, `POST /api/`, `PUT /api/`, `DELETE /api/`, `PATCH /api/`
- **UI Components**: Pattern match "button", "form", "handler", "onClick", "component", "modal", "page"
- **Agent Modes**: Pattern match `mode:`, `{mode:`, agent output formats, `"mode"`
- **Database Tables/Fields**: Pattern match table schemas, SQL, database references, "table", "column", "schema"
- **Events/Webhooks**: Pattern match "webhook", "event", "trigger", "listener", "subscriber"

**Connection Detection Algorithm:**
1. **Exact Name Matching**: Cross-reference extracted components by name similarity
   - Example: "importButton" matches "handleImport" (fuzzy match threshold: 70%)
   
2. **Explicit Connection Statements**: Search for documented relationships
   - "Button X calls API Y"
   - "Handler Z triggers mode W"
   - "Endpoint A updates table B"
   - "Mode C opens modal D"
   
3. **Acceptance Criteria Parsing**: Extract integration assertions from requirements
   - Example: "When user clicks X, system should Y" implies X→Y connection
   
4. **Zero-Reference Flagging**: Components with no matches in steps 1-3 are flagged as orphaned

**Handling Dynamic Components:**

When static analysis encounters dynamic references (e.g., `components[dynamicKey]`, `handlers[mode]`), system:
1. Flags as "UNVERIFIABLE_CONNECTION" (not orphaned, but requires manual review)
2. Generates warning: "Component uses dynamic reference - cannot verify integration chain automatically"
3. Requests user to document the dynamic pattern:
   ```markdown
   ### Dynamic Component Pattern: Modal Rendering
   - Pattern: `components[agent.mode]` dynamically selects modal component
   - Possible values: ["reviewImport", "createLabel", "logBrew"]
   - Each mode maps to component: {"reviewImport": "ImportReviewModal", ...}
   - Integration chain: Agent outputs mode → Dynamic lookup → Modal renders
   ```
4. If user documents pattern, system attempts to verify each possible value

**Orphaned Component Report Example:**
```markdown
## Integration Validation Findings

**Potential Orphaned Components:**
1. **API Endpoint:** `POST /api/labels/generate`
   - Defined in: Section "FR3: Label Generation API"
   - No UI handler reference found
   - No acceptance criteria mentioning this endpoint
   - Recommendation: Add section specifying which UI component calls this endpoint and what happens with the response

2. **Agent Mode:** `{mode: "reviewImport"}`
   - Defined in: Section "System Prompt Outputs"
   - No UI handler or API endpoint reference found
   - Recommendation: Document the integration chain: Agent outputs mode → Which UI function handles it → What action that function takes

3. **Database Table:** `brew_logs`
   - Defined in: Section "Database Schema"
   - No API endpoint documented for CRUD operations
   - Recommendation: Specify which endpoints interact with this table or mark as read-only/system-managed

**Verified Integration Chains:**
1. **Chain: Bean Creation Flow**
   - UI Button "Create Label" (`<button onClick={handleCreateLabel}>`)
   - → Handler `handleCreateLabel()` (defined in "UI Handlers")
   - → API `POST /api/beans` (defined in "API Endpoints")
   - → Database insert into `beans` table (defined in "Database Schema")
   - → Success response renders toast notification (defined in "UI Feedback")
   - Coverage Score: 95% (all connections documented)

2. **Chain: Brew Logging Flow**
   - Agent Mode `{mode: "logBrew"}` (defined in "Agent Outputs")
   - → UI Handler `handleLogBrew()` (defined in "Agent Mode Handlers")
   - → API `POST /api/brews` (defined in "Brewing API")
   - → Database insert into `brews` table (defined in "Database Schema")
   - → UI navigates to brew detail page (defined in "Navigation Flows")
   - Coverage Score: 100% (complete documentation with error handling)

**Warnings (Weak Connections):**
- Handler `handleDelete()` references API `DELETE /api/beans/:id` but no error handling documented
  - Impact: If deletion fails, user may see stale data or no feedback
  - Mitigation: Add error handling section specifying retry logic or user notification
  
- Modal component `ImportReviewModal` is mentioned but no trigger mechanism specified
  - Impact: Modal may be implemented but never shown to users
  - Mitigation: Document which event/action opens this modal

**Dynamically Named Components (Manual Review Required):**
- Pattern: `components[agent.mode]` in section "Agent Mode Handling"
  - Possible values: ["reviewImport", "createLabel", "logBrew"]
  - Request: Document mapping of each mode to specific component name
```

**User Resolution Workflow:**

When orphaned components are detected, user must choose:

**Option 1: Confirm Intentional Orphan**
- Use case: Component is for future use, deprecated, or system-internal
- Action: Add comment to PRD: `<!-- INTENTIONAL_ORPHAN: [component] - [reason] -->`
- Example: `<!-- INTENTIONAL_ORPHAN: POST /api/admin/reset - Internal admin tool, not user-facing -->`
- Result: Static analysis ignores this component in future runs

**Option 2: Add Integration Chain**
- Use case: Valid orphan detection - missing connection documentation
- Action: User adds new subsection to PRD:
  ```markdown
  ### Integration Flow: [Feature Name]
  1. User triggers: [UI action] (e.g., clicks button with data-testid="import-button")
  2. Handler `[functionName]` is called (defined in section X)
  3. Handler calls API `[endpoint]` with params `[params]`
  4. API updates database table `[table]` (defined in section Y)
  5. Response triggers UI update: [outcome] (e.g., toast notification, page navigation)
  6. Error handling: [error scenarios and user-visible behavior]
  ```
- Result: Static analysis re-runs, verifies chain is now complete

**Option 3: Remove Orphaned Component**
- Use case: False requirement - component shouldn't exist
- Action: Delete component definition from PRD
- Result: Component no longer flagged

**Option 4: Document Dynamic Pattern**
- Use case: Component uses dynamic naming (e.g., `components[key]`)
- Action: Add pattern documentation explaining all possible values and their mappings
- Result: System verifies each possible value in the pattern

**Critic Integration Validation Requirements:**

During debate rounds, critics MUST verify:
1. **Every user-facing feature has end-to-end documentation**
   - Example challenge: "FR5 describes 'Export Beans' feature but does not specify which UI element triggers this action or what happens after export completes. User impact: Feature may be implemented but unreachable."
   
2. **Every API endpoint specifies caller and response handler**
   - Example challenge: "Endpoint `GET /api/stats` is defined but PRD does not document which page or component consumes this data or how it's displayed to the user. User impact: API may work but data never shown."

3. **Every agent mode defines UI processing**
   - Example challenge: "Agent mode `{mode: 'createRecipe'}` is listed in outputs but no UI handler function is documented to process this mode. User impact: Agent will output the mode but nothing will happen - completely broken user experience."

4. **Every database operation connects to a feature**
   - Example challenge: "Table `roast_profiles` is defined in schema but no feature requirement explains when/how this table is populated or queried. User impact: Table may be created but never used, leading to dead code."

5. **Error handling is documented for each integration point**
   - Example challenge: "Integration chain for 'Import Beans' does not specify what happens if API returns 500 error. User impact: Silent failure or app crash - no user feedback."

If integration chains are missing, critics MUST challenge using this format:
```
INTEGRATION GAP DETECTED:
- Component: [type and name]
- Defined in: [PRD section]
- Missing connection: [what's not documented]
- User impact: [what breaks if this stays orphaned]
- Required fix: [specific documentation needed]

Example:
INTEGRATION GAP DETECTED:
- Component: API Endpoint POST /api/labels/generate
- Defined in: Section "FR3: Label Generation API"
- Missing connection: No UI handler or button documented that calls this endpoint
- User impact: API will be implemented but unreachable by users - wasted development effort
- Required fix: Add "Integration Flow" subsection specifying which UI component triggers this API call and what happens with the response
```

### Test Generation (NEW)

**Test Suite Structure:**

For each verified integration chain, generate:

1. **End-to-End Integration Test**
   - Starts from user action (button click, form submit)
   - Exercises full stack (UI → API → DB → Response → UI update)
   - Asserts on final user-visible state
   - **Error scenarios tested**: Invalid input, network failure, database constraint violations

2. **API Contract Test**
   - Validates request/response schemas match PRD specifications
   - Tests success cases (200, 201 responses)
   - Tests error cases (400, 401, 403, 404, 500 responses)
   - Ensures API fulfills its documented contract
   - **Edge cases**: Empty payloads, oversized requests, malformed JSON

3. **Vertical Slice Test** (for complex features)
   - Tests specific user workflow from start to finish
   - Includes setup (seed test data), action (trigger workflow), multiple assertions (verify each step), teardown (cleanup)
   - Example: "User creates bean → assigns roast profile → logs brew → views brew history"

**Test Framework Selection:**

System detects tech stack from PRD keywords and generates appropriate tests:

| Tech Stack Detected | Generated Framework | Detection Keywords |
|---------------------|---------------------|-------------------|
| React/Next.js | Playwright + React Testing Library | "React", "Next.js", "JSX", "tsx" |
| Vue | Vitest + Vue Test Utils | "Vue", "Nuxt", "vue" |
| Python/Flask | pytest + Flask test client | "Flask", "Python", "app.py" |
| Node/Express | Jest + supertest | "Express", "Node.js", "app.js" |
| Django | pytest-django | "Django", "Python", "models.py" |

If no framework is detected, system defaults to Playwright (web) or pytest (backend) and asks user to confirm.

**Example Generated Test (React + Playwright):**

```typescript
// tests/integration/bean-import.spec.ts
// Generated by PRD Gauntlet v4.0 for integration chain: "Import Review Workflow"
// PRD Section: FR4 > Agent-Driven Import Review

import { test, expect } from '@playwright/test';

test.describe('Import review workflow - complete integration', () => {
  test.beforeEach(async ({ page }) => {
    // Setup: Authenticate and seed test data
    await page.goto('/login');
    await page.fill('[data-testid="email"]', 'test@example.com');
    await page.fill('[data-testid="password"]', 'testpass123');
    await page.click('[data-testid="login-button"]');
    await expect(page).toHaveURL('/dashboard');
  });

  test('Success path: Agent mode triggers modal, user imports beans', async ({ page }) => {
    // Navigate to chat interface
    await page.goto('/chat');
    
    // Action 1: Trigger agent mode via chat
    await page.fill('[data-testid="chat-input"]', 'Review these beans for import');
    await page.click('[data-testid="send-button"]');
    
    // Assert: Agent responds with reviewImport mode
    // FAILURE MESSAGE: "Import review modal should appear after agent outputs {mode: 'reviewImport'}.
    // Check: 1) Agent prompt returns correct mode, 2) UI handler processes this mode, 3) Modal component is registered"
    await expect(page.locator('[data-testid="import-review-modal"]')).toBeVisible({ 
      timeout: 5000,
      message: 'Import review modal should appear after agent outputs reviewImport mode. Verify: 1) Agent returns {mode: "reviewImport"}, 2) handleAgentMode() processes this mode, 3) ImportReviewModal component exists'
    });
    await expect(page.locator('[data-testid="import-review-modal"]')).toContainText('Review Beans', {
      message: 'Modal should display "Review Beans" header - check ImportReviewModal component rendering'
    });
    
    // Action 2: Select beans in modal
    await page.click('[data-testid="bean-checkbox-1"]');
    await page.click('[data-testid="bean-checkbox-2"]');
    await page.click('[data-testid="import-selected-button"]');
    
    // Assert: API call made with correct payload
    // FAILURE MESSAGE: "No API request to /api/beans/import detected.
    // Check: 1) handleImportSelected() is wired to button click, 2) Function calls fetch(/api/beans/import)"
    const apiRequest = await page.waitForRequest(req => 
      req.url().includes('/api/beans/import') && 
      req.method() === 'POST',
      { timeout: 3000 }
    ).catch(() => {
      throw new Error('No POST request to /api/beans/import detected within 3s. Verify: 1) Import button onClick handler exists, 2) Handler calls API endpoint');
    });
    
    const requestBody = apiRequest.postDataJSON();
    expect(requestBody.beanIds).toHaveLength(2, {
      message: 'API request should include 2 selected bean IDs - check handleImportSelected() builds correct payload'
    });
    
    // Assert: Database updated (verify via subsequent API call)
    // FAILURE MESSAGE: "Beans not found in database after import.
    // Check: 1) API endpoint saves to database, 2) Database transaction commits, 3) GET /beans returns updated data"
    await page.goto('/beans');
    await page.waitForSelector('[data-testid="bean-row"]', { 
      timeout: 5000,
      message: 'Bean list should load after import. Verify: 1) API persisted beans to DB, 2) /beans page queries database, 3) Bean rows render'
    });
    const beanRows = await page.locator('[data-testid="bean-row"]').count();
    expect(beanRows).toBeGreaterThanOrEqual(2, {
      message: `Expected at least 2 imported beans, found ${beanRows}. Verify database insert succeeded and GET /beans query is correct`
    });
    
    // Assert: Success notification shown
    // FAILURE MESSAGE: "No success toast after import.
    // Check: 1) API returns 200 status, 2) Response handler shows toast, 3) Toast component is rendered"
    await expect(page.locator('.toast-success')).toContainText('2 beans imported successfully', {
      timeout: 3000,
      message: 'Success toast should appear with "2 beans imported successfully". Verify: 1) API response triggers toast, 2) Toast displays correct count'
    });
  });

  test('Error path: Invalid bean selection shows error', async ({ page }) => {
    await page.goto('/chat');
    await page.fill('[data-testid="chat-input"]', 'Review these beans for import');
    await page.click('[data-testid="send-button"]');
    
    await expect(page.locator('[data-testid="import-review-modal"]')).toBeVisible();
    
    // Don't select any beans
    await page.click('[data-testid="import-selected-button"]');
    
    // Assert: Client-side validation prevents API call
    // FAILURE MESSAGE: "No validation error shown when importing with no selection"
    await expect(page.locator('.toast-error')).toContainText('Please select at least one bean', {
      timeout: 2000,
      message: 'Error toast should appear when no beans selected. Verify handleImportSelected() validates selection before API call'
    });
    
    // Modal should stay open for user to correct
    await expect(page.locator('[data-testid="import-review-modal"]')).toBeVisible({
      message: 'Modal should remain open after validation error so user can select beans'
    });
  });

  test('Error path: API failure shows user-friendly message', async ({ page }) => {
    // Mock API failure
    await page.route('/api/beans/import', route => {
      route.fulfill({
        status: 500,
        body: JSON.stringify({ error: 'Database connection failed' })
      });
    });

    await page.goto('/chat');
    await page.fill('[data-testid="chat-input"]', 'Review these beans for import');
    await page.click('[data-testid="send-button"]');
    
    await expect(page.locator('[data-testid="import-review-modal"]')).toBeVisible();
    await page.click('[data-testid="bean-checkbox-1"]');
    await page.click('[data-testid="import-selected-button"]');
    
    // Assert: 500 error is caught and surfaced to user
    // FAILURE MESSAGE: "No error feedback when API returns 500"
    await expect(page.locator('.toast-error')).toContainText('Import failed', {
      timeout: 3000,
      message: 'Error toast should appear when API returns 500. Verify: 1) API error is caught in handleImportSelected(), 2) Error toast is triggered with user-friendly message'
    });
    
    // User impact mitigation: Modal stays open so user can retry
    await expect(page.locator('[data-testid="import-review-modal"]')).toBeVisible({
      message: 'Modal should remain open after API error so user can retry import'
    });
  });

  test('Error path: Network timeout shows retry option', async ({ page }) => {
    // Mock slow API (timeout scenario)
    await page.route('/api/beans/import', route => {
      // Never resolve - simulates network timeout
      return new Promise(() => {});
    });

    await page.goto('/chat');
    await page.fill('[data-testid="chat-input"]', 'Review these beans for import');
    await page.click('[data-testid="send-button"]');
    
    await expect(page.locator('[data-testid="import-review-modal"]')).toBeVisible();
    await page.click('[data-testid="bean-checkbox-1"]');
    await page.click('[data-testid="import-selected-button"]');
    
    // Assert: Timeout is handled gracefully
    await expect(page.locator('.toast-error')).toContainText('Request timed out', {
      timeout: 35000,  // Wait for timeout threshold (usually 30s)
      message: 'Timeout error should appear after network timeout. Verify: 1) API call has timeout configured, 2) Timeout error shows user-friendly message'
    });
    
    // User impact mitigation: Retry button should be available
    await expect(page.locator('[data-testid="retry-import-button"]')).toBeVisible({
      message: 'Retry button should appear after timeout so user can attempt import again'
    });
  });

  test.afterEach(async ({ page, context }) => {
    // Cleanup: Delete test data
    await page.request.delete('/api/test-data/cleanup');
    await context.close();
  });
});
```

**Specific Failure Message Examples:**

| Test Scenario | Failure Message | Diagnostic Guidance |
|---------------|-----------------|---------------------|
| Modal not appearing | "Import review modal should appear after agent outputs reviewImport mode. Verify: 1) Agent returns {mode: 'reviewImport'}, 2) handleAgentMode() processes this mode, 3) ImportReviewModal component exists" | Points to 3 specific integration points to check |
| API not called | "No POST request to /api/beans/import detected within 3s. Verify: 1) Import button onClick handler exists, 2) Handler calls API endpoint" | Indicates UI→API connection is broken |
| Database not updated | "Expected at least 2 imported beans, found 0. Verify database insert succeeded and GET /beans query is correct" | Includes actual count to help diagnose partial failures |
| No error handling | "Error toast should appear when API returns 500. Verify: 1) API error is caught in handleImportSelected(), 2) Error toast is triggered with user-friendly message" | Explains what error handling code is missing |

**Test Generation Algorithm (Detailed):**

```typescript
interface TestGenerationConfig {
  prdContent: string;
  integrationChains: IntegrationChain[];
  testFramework: 'playwright' | 'vitest' | 'jest' | 'pytest';
  errorScenarios: ErrorScenario[];
}

interface IntegrationChain {
  chainId: string;
  featureName: string;
  steps: ChainStep[];
  acceptanceCriteria: string[];
  errorHandling: string[];
}

interface ChainStep {
  type: 'UI_ACTION' | 'API_CALL' | 'DB_CHANGE' | 'UI_UPDATE' | 'AGENT_OUTPUT';
  component: string;
  action: string;
  expectedOutcome: string;
  dataTestId?: string;  // For UI elements
  endpoint?: string;    // For API calls
  tableName?: string;   // For DB operations
  failureMessage: string;  // Specific diagnostic message if this step fails
}

interface ErrorScenario {
  name: string;
  triggerCondition: string;
  expectedBehavior: string;
  userImpact: string;  // NEW: What user experiences if error handling is missing
  mitigationStrategy: string;  // NEW: How system should recover
}

function generateIntegrationTests(config: TestGenerationConfig): TestSuite {
  const testSuite = new TestSuite();
  
  for (const chain of config.integrationChains) {
    // Parse the chain: UI → API → DB → Response → UI
    const steps = chain.steps;
    
    // Generate success path test
    const successTest = new Test(`${chain.featureName} - success path`);
    
    // Add setup (navigate, authenticate, seed data)
    successTest.addSetup(generateSetup(steps, config.testFramework));
    
    // Add action steps with assertions
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      if (step.type === 'UI_ACTION') {
        successTest.addAction(generateUIAction(step, config.testFramework));
      } else if (step.type === 'API_CALL') {
        successTest.addAssertion(generateAPIAssertion(step, config.testFramework));
      } else if (step.type === 'DB_CHANGE') {
        successTest.addAssertion(generateDBAssertion(step, config.testFramework));
      } else if (step.type === 'UI_UPDATE') {
        successTest.addAssertion(generateUIAssertion(step, config.testFramework));
      } else if (step.type === 'AGENT_OUTPUT') {
        successTest.addAssertion(generateAgentAssertion(step, config.testFramework));
      }
    }
    
    // Add teardown (cleanup test data)
    successTest.addTeardown(generateTeardown(steps, config.testFramework));
    testSuite.addTest(successTest);
    
    // Generate error path tests from PRD error handling section
    for (const error
