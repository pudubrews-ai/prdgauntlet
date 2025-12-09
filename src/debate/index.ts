// ============================================================================
// Debate Module - Re-exports
// ============================================================================

export {
  runDebate,
  type DebateConfig,
  type DebateContext,
} from './engine.js';

export {
  detectConsensus,
  isMalformedResponse,
  extractUnresolvedConcerns,
} from './consensus.js';

export {
  parseDefenderResponse,
  extractDefenderQuestion,
  isRequestingClarification,
  type ParsedDefenderResponse,
} from './parser.js';

export {
  detectConflict,
  summarizeConflicts,
  getConflictsBySource,
  buildConflictContext,
  type ConflictDetection,
} from './conflict.js';
