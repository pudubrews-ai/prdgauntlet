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
    includeTranscripts?: boolean;
    models?: {
      chatgpt?: string;
      gemini?: string;
    };
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
}

export type GauntletErrorCode = 'INVALID_INPUT' | 'PROVIDER_ERROR' | 'CONFIG_ERROR';

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
  | 'complete'
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

export interface GauntletConfig {
  // API Keys (from environment)
  anthropicApiKey: string;
  openaiApiKey: string;
  googleApiKey: string;

  // Defaults
  maxRoundsPerModel: number;
  maxTotalTokens?: number;
  maxEstimatedCost?: number;
  maxConcurrentJobs: number;
  includeTranscripts: boolean;

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
