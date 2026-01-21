// ============================================================================
// PRD Gauntlet MCP Server - Type Definitions
// ============================================================================

// ----------------------------------------------------------------------------
// Tool Input/Output Types
// ----------------------------------------------------------------------------

export interface GauntletInput {
  prd: string;
  metadata?: {
    title?: string;
    productContext?: string;
    constraints?: string[];
  };
  config?: {
    maxRoundsPerModel?: number;
    maxTotalTokens?: number;
    maxEstimatedCost?: number;
    apiTimeoutMs?: number; // Per-API-call timeout in ms. Default: 600000 (10 min)
    includeTranscripts?: boolean;
    transcriptSummaryOnly?: boolean; // PRD v3.0: condensed summaries instead of full exchanges
    targetedSections?: string[];     // PRD v3.0: for targeted re-debate on specific sections
    forceUnlockReverts?: boolean; // Override revert locks in exceptional cases
    models?: {
      claude?: string;
      chatgpt?: string;
      gemini?: string;
    };
    webhookUrl?: string;             // PRD v3.0: URL for user notifications
    webhookAuth?: WebhookAuth;       // PRD v3.0: webhook authentication config
  };
}

export interface GauntletOutput {
  jobId: string;
  finalPrd: string;
  changelog: ChangeEntry[];
  debates?: {
    chatgpt?: DebateSummary | DebateTranscript;
    gemini?: DebateSummary | DebateTranscript;
  };
  stats: GauntletStats;
}

export interface GauntletStats {
  totalRounds: number;
  tokensUsed: {
    claude: number;
    chatgpt: number;
    gemini: number;
  };
  estimatedCost: number;
  stoppedEarly?: {
    reason: 'cost_cap' | 'token_cap' | 'timeout';
    atModel?: CriticModel;
    unresolvedConcerns: string[];
  };
  skippedCritics?: Array<{
    model: CriticModel;
    reason: string;
  }>;
  highConflictSections?: string[];
}

export type GauntletErrorCode =
  | 'INVALID_INPUT'
  | 'PROVIDER_ERROR'
  | 'CONFIG_ERROR'
  | 'PRD_TOO_LARGE'
  | 'RATE_LIMIT_EXCEEDED';

export interface GauntletError {
  error: GauntletErrorCode;
  message: string;
  details?: Record<string, unknown>;
}

// ----------------------------------------------------------------------------
// Debate Types
// ----------------------------------------------------------------------------

export type CriticModel = 'chatgpt' | 'gemini';
export type ModelName = 'claude' | CriticModel;

export interface DebateSummary {
  rounds: number;
  outcome: 'consensus' | 'max_rounds' | 'early_stop';
  keyChanges: string[];
  unresolvedConcerns?: string[];
}

export interface DebateTranscript {
  summary: DebateSummary;
  messages: DebateMessage[];
}

export interface DebateMessage {
  role: 'defender' | 'critic';
  content: string;
  timestamp: string;
}

export interface DebateResult {
  finalPrd: string;
  transcript: DebateTranscript;
  changes: ChangeEntry[];
  outcome: 'consensus' | 'max_rounds' | 'early_stop';
  unresolvedConcerns: string[];
  tokensUsed: {
    defender: number;
    critic: number;
  };
}

// ----------------------------------------------------------------------------
// Change Tracking Types
// ----------------------------------------------------------------------------

export type ChangeType = 'addition' | 'modification' | 'deletion' | 'revert';

export interface ChangeEntry {
  version: number;
  source: CriticModel;
  round: number;
  type: ChangeType;
  summary: string;
  section?: string;
  diff?: string;
  revertedChange?: number;
}

export interface RoundDelta {
  type: ChangeType;
  summary: string;
  section?: string;
}

// ----------------------------------------------------------------------------
// Job Management Types
// ----------------------------------------------------------------------------

export type JobStatus =
  | 'idle'
  | 'debating_chatgpt'
  | 'debating_gemini'
  | 'awaiting_user_input'  // PRD v3.0: paused for undefined term clarification
  | 'complete'
  | 'consensus_failed'     // PRD v3.0: max rounds reached without consensus
  | 'error';

export interface JobState {
  jobId: string;
  status: JobStatus;
  currentRound?: number;
  currentModel?: CriticModel;
  createdAt: string;
  lastUpdate: string;
  partialResult?: {
    currentPrd: string;
    changelogSoFar: ChangeEntry[];
  };
  transcripts?: {
    chatgpt?: DebateTranscript;
    gemini?: DebateTranscript;
  };
  result?: GauntletOutput;
  error?: GauntletError;
}

// ----------------------------------------------------------------------------
// Configuration Types
// ----------------------------------------------------------------------------

export interface CostRates {
  claude: { input: number; output: number };
  chatgpt: { input: number; output: number };
  gemini: { input: number; output: number };
}

export interface FallbackPolicy {
  onModelUnavailable: 'skip' | 'error';
  onInvalidModelId: 'error';
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  burstSize: number;
}

export interface RevertLock {
  section: string;
  changeType: ChangeType;
  lockedAt: number; // version number when lock was applied
  source: CriticModel;
}

export interface GauntletConfig {
  // API Keys (from environment)
  anthropicApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;

  // Defaults
  maxRoundsPerModel: number;
  maxTotalTokens?: number;
  maxEstimatedCost?: number;
  apiTimeoutMs: number; // Per-API-call timeout in ms. Default: 600000 (10 min)
  maxConcurrentJobs: number;
  includeTranscripts: boolean;
  forceUnlockReverts: boolean; // Override revert locks in exceptional cases

  // Models
  models: {
    claude: string;
    chatgpt: string;
    gemini: string;
  };

  // Prompts
  prompts?: {
    defender?: string;
    critic?: string;
  };

  // Policies
  fallbackPolicy: FallbackPolicy;
  retryOnTimeout: boolean;

  // Rate limiting (FR12)
  rateLimiting: RateLimitConfig;

  // Cost tracking
  costRates: CostRates;

  // Debug
  debug: boolean;
}

// ----------------------------------------------------------------------------
// API Client Types
// ----------------------------------------------------------------------------

export interface LLMMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface LLMResponse {
  content: string;
  usage: {
    inputTokens: number;
    outputTokens: number;
  };
}

export interface LLMClient {
  chat(messages: LLMMessage[], systemPrompt: string): Promise<LLMResponse>;
  validateModel(): Promise<boolean>;
  getModelId(): string;
}

export interface ValidationResult {
  model: ModelName;
  modelId: string;
  valid: boolean;
  error?: string;
  timestamp: string;
}

// ----------------------------------------------------------------------------
// Consensus Detection Types
// ----------------------------------------------------------------------------

export interface ConsensusResult {
  isConsensus: boolean;
  isConditional: boolean;
  condition?: string;
  isMalformed: boolean;
}

export interface StructuredApproval {
  approved: boolean;
  remainingConcerns: string[];
}

// ----------------------------------------------------------------------------
// Health Check Types
// ----------------------------------------------------------------------------

export interface HealthInput {
  forceRefresh?: boolean;
}

export interface HealthOutput {
  status: 'healthy' | 'degraded' | 'unhealthy';
  version: string;
  uptime: number;
  activeJobs: number;
  maxConcurrentJobs: number;
  providers: {
    claude: ValidationResult;
    chatgpt: ValidationResult;
    gemini: ValidationResult;
  };
  config: {
    maxRoundsPerModel: number;
    maxTotalTokens?: number;
    maxEstimatedCost?: number;
    apiTimeoutMs: number;
    retryOnTimeout: boolean;
  };
}

// ----------------------------------------------------------------------------
// Status Check Types (Phase 2)
// ----------------------------------------------------------------------------

export interface StatusInput {
  jobId: string;
}

export interface StatusOutput {
  jobId: string;
  status: JobStatus;
  currentRound?: number;
  currentModel?: CriticModel;
  lastUpdate?: string;
  partialResult?: {
    currentPrd: string;
    changelogSoFar: ChangeEntry[];
  };
}

export interface StatusError {
  error: 'JOB_NOT_FOUND';
  message: string;
}

// ----------------------------------------------------------------------------
// Transcript Retrieval Types (Phase 2)
// ----------------------------------------------------------------------------

export interface TranscriptInput {
  jobId: string;
  model: CriticModel;
}

export interface TranscriptOutput {
  transcript: DebateTranscript;
}

export type TranscriptErrorCode =
  | 'JOB_NOT_FOUND'
  | 'TRANSCRIPT_UNAVAILABLE'
  | 'CRITIC_SKIPPED';

export interface TranscriptError {
  error: TranscriptErrorCode;
  message: string;
}

// ----------------------------------------------------------------------------
// List Jobs Types (Phase 2)
// ----------------------------------------------------------------------------

export interface ListJobsInput {
  status?: JobStatus | 'all';
  limit?: number;
}

export interface JobSummary {
  jobId: string;
  status: JobStatus;
  createdAt: string;
  lastUpdate: string;
  currentRound?: number;
  currentModel?: CriticModel;
}

export interface ListJobsOutput {
  jobs: JobSummary[];
  total: number;
}

// ----------------------------------------------------------------------------
// PRD v3.0 New Features
// ----------------------------------------------------------------------------

// Webhook Configuration (PRD v3.0)
export interface WebhookAuth {
  type: 'bearer' | 'hmac';
  token?: string;  // Required for bearer
  secret?: string; // Generated for HMAC, returned to user
}

export interface WebhookPayload {
  jobId: string;
  event: 'user_input_required';
  reason: 'undefined_term_stall' | 'consensus_conflict';
  details: {
    term?: string;
    context?: string;
    researchAttempts?: number;
    ambiguousResults?: string[];
    unresolvedSections?: string[];
  };
  responseUrl: string;
  timeoutAt: string;
}

// Divergence Report (PRD v3.0 - Consensus Failure)
export interface DivergenceReport {
  format: 'structured_json';
  reportVersion: '1.0';
  unresolvedSections: UnresolvedSection[];
  recommendedAction: string;
  totalUnresolvedIssues: number;
  metricsSummary: {
    roundsCompleted: number;
    convergenceRate: number;  // 0.0 to 1.0
    avgIssuesPerRound: number;
  };
}

export interface UnresolvedSection {
  section: string;
  sectionLineNumbers: [number, number];
  chatgptPosition?: CriticPosition;
  geminiPosition?: CriticPosition;
  claudeAssessment: ClaudeAssessment;
  impactedRequirements: string[];
  roundFirstRaised: number;
}

export interface CriticPosition {
  summary: string;
  rationale: string;
  confidence: 'low' | 'medium' | 'high';
}

export interface ClaudeAssessment {
  summary: string;
  recommendation: string;
  blockingSeverity: 'low' | 'medium' | 'high';
}

export interface EscalationOptions {
  acceptBestEffort: {
    action: string;
    riskLevel: 'low' | 'medium' | 'high';
    rationale: string;
  };
  manualResolve: {
    action: string;
    estimatedTime: string;
    guidedQuestions: string[];
  };
  targetedRedebate: {
    action: string;
    sections: string[];
    additionalRounds: number;
    estimatedCost: string;
    costBreakdown: {
      calculation: string;
      chatgptCost: string;
      geminiCost: string;
      totalEstimate: string;
    };
    estimatedTime: string;
    completeExample: {
      description: string;
      code: string;
      notes: string[];
    };
  };
}

// Terminology Research (PRD v3.0)
export interface TerminologyResearch {
  term: string;
  found: boolean;
  fullName?: string;
  version?: string;
  sourceUrl?: string;
  multipleStandards?: {
    name: string;
    version: string;
    url: string;
    releasedDate?: string;
  }[];
  needsUserClarification: boolean;
}

// Loop Detection (PRD v3.0)
export interface IssueLoop {
  issue: string;
  timeline: LoopEvent[];
  detectedAtRound: number;
}

export interface LoopEvent {
  round: number;
  critic: CriticModel;
  action: 'raised' | 'accepted' | 'rejected' | 'raised_again';
}

// Reversion Tracking (PRD v3.0)
export interface Reversion {
  round: number;
  change: string;
  reason: string;
  originalCritic: CriticModel;
  reversingCritic: CriticModel;
}

// Enhanced Stats for v3.0
export interface GauntletStatsV3 extends GauntletStats {
  terminologyResearched?: string[];
  cacheHits?: number;
  cacheMisses?: number;
  reversions?: Reversion[];
  reversionCount?: number;
  highChurn?: boolean;
  loopsDetected?: IssueLoop[];
}
