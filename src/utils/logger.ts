// ============================================================================
// Structured Logger - No PRD content by default (NFR4)
// ============================================================================

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  jobId?: string;
  model?: string;
  round?: number;
  tokens?: { input: number; output: number };
  cost?: number;
  outcome?: string;
  error?: string;
  [key: string]: unknown;
}

class Logger {
  private debug: boolean;

  constructor() {
    this.debug = process.env.DEBUG === 'true';
  }

  setDebug(enabled: boolean): void {
    this.debug = enabled;
  }

  private formatEntry(entry: LogEntry): string {
    return JSON.stringify(entry);
  }

  private log(level: LogLevel, message: string, meta?: Omit<LogEntry, 'timestamp' | 'level' | 'message'>): void {
    // Skip debug logs unless debug mode is enabled
    if (level === 'debug' && !this.debug) {
      return;
    }

    const entry: LogEntry = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...meta,
    };

    const output = this.formatEntry(entry);

    // Always write to stderr to avoid interfering with MCP stdio protocol
    // stdout is reserved for JSON-RPC messages
    process.stderr.write(output + '\n');
  }

  logDebug(message: string, meta?: Omit<LogEntry, 'timestamp' | 'level' | 'message'>): void {
    this.log('debug', message, meta);
  }

  logInfo(message: string, meta?: Omit<LogEntry, 'timestamp' | 'level' | 'message'>): void {
    this.log('info', message, meta);
  }

  logWarn(message: string, meta?: Omit<LogEntry, 'timestamp' | 'level' | 'message'>): void {
    this.log('warn', message, meta);
  }

  logError(message: string, meta?: Omit<LogEntry, 'timestamp' | 'level' | 'message'>): void {
    this.log('error', message, meta);
  }

  // Specialized logging methods for gauntlet operations
  logJobCreated(jobId: string): void {
    this.logInfo('Job created', { jobId });
  }

  logJobCompleted(jobId: string, stats: { rounds: number; cost: number; outcome: string }): void {
    this.logInfo('Job completed', {
      jobId,
      round: stats.rounds,
      cost: stats.cost,
      outcome: stats.outcome,
    });
  }

  logDebateRound(jobId: string, model: string, round: number, tokens: { input: number; output: number }): void {
    this.logInfo('Debate round completed', {
      jobId,
      model,
      round,
      tokens,
    });
  }

  logConsensusReached(jobId: string, model: string, round: number): void {
    this.logInfo('Consensus reached', { jobId, model, round });
  }

  logEarlyStop(jobId: string, reason: string, model?: string): void {
    this.logWarn('Early stop triggered', { jobId, model, outcome: reason });
  }

  logProviderError(jobId: string, model: string, error: string): void {
    this.logError('Provider error', { jobId, model, error });
  }

  logMalformedResponse(jobId: string, model: string, round: number, consecutiveCount: number): void {
    this.logWarn('Malformed response from critic', {
      jobId,
      model,
      round,
      consecutiveCount,
    });
  }

  logValidation(model: string, valid: boolean, error?: string): void {
    if (valid) {
      this.logInfo('Model validation passed', { model });
    } else {
      this.logWarn('Model validation failed', { model, error });
    }
  }

  // Debug-only: log content (only when DEBUG=true)
  logContent(message: string, content: string, meta?: Record<string, unknown>): void {
    if (this.debug) {
      this.logDebug(message, { ...meta, contentLength: content.length, contentPreview: content.substring(0, 200) });
    }
  }
}

export const logger = new Logger();
