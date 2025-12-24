// ============================================================================
// Configuration Loader (FR8)
// ============================================================================

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import type { GauntletConfig, CostRates, FallbackPolicy, RateLimitConfig } from '../types/index.js';
import { DEFAULT_COST_RATES } from './cost.js';

interface ConfigFile {
  maxRoundsPerModel?: number;
  maxTotalTokens?: number;
  maxEstimatedCost?: number;
  apiTimeoutMs?: number;
  maxConcurrentJobs?: number;
  includeTranscripts?: boolean;
  forceUnlockReverts?: boolean;
  retryOnTimeout?: boolean;
  debug?: boolean;
  models?: {
    claude?: string;
    chatgpt?: string;
    gemini?: string;
  };
  prompts?: {
    defender?: string;
    critic?: string;
  };
  fallbackPolicy?: Partial<FallbackPolicy>;
  rateLimiting?: Partial<RateLimitConfig>;
  costRates?: Partial<CostRates>;
}

const DEFAULT_CONFIG: Omit<GauntletConfig, 'anthropicApiKey' | 'openaiApiKey' | 'googleApiKey'> = {
  maxRoundsPerModel: 5,
  apiTimeoutMs: 600_000, // 10 minutes per PRD v2.3.1
  maxConcurrentJobs: 3,
  includeTranscripts: false,
  forceUnlockReverts: false, // FR6: Override revert locks in exceptional cases
  retryOnTimeout: true,
  debug: false,
  models: {
    claude: 'claude-sonnet-4-5-20250929',
    chatgpt: 'gpt-4o',
    gemini: 'gemini-2.0-flash',
  },
  fallbackPolicy: {
    onModelUnavailable: 'skip',
    onInvalidModelId: 'error',
  },
  rateLimiting: {
    requestsPerMinute: 10,
    burstSize: 3,
  },
  costRates: DEFAULT_COST_RATES,
};

function loadConfigFile(configPath?: string): ConfigFile | null {
  const paths = [
    configPath,
    resolve(process.cwd(), 'gauntlet.config.json'),
    resolve(process.cwd(), '.gauntlet.json'),
  ].filter(Boolean) as string[];

  for (const path of paths) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, 'utf-8');
        return JSON.parse(content) as ConfigFile;
      } catch {
        // Continue to next path
      }
    }
  }

  return null;
}

function getRequiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(configPath?: string): GauntletConfig {
  // Load environment variables
  const anthropicApiKey = getRequiredEnv('ANTHROPIC_API_KEY');
  const openaiApiKey = getRequiredEnv('OPENAI_API_KEY');
  const googleApiKey = getRequiredEnv('GOOGLE_AI_API_KEY');

  // Load config file if exists
  const fileConfig = loadConfigFile(configPath);

  // Merge configs: defaults < file < env overrides
  const config: GauntletConfig = {
    ...DEFAULT_CONFIG,
    anthropicApiKey,
    openaiApiKey,
    googleApiKey,
  };

  if (fileConfig) {
    if (fileConfig.maxRoundsPerModel !== undefined) {
      config.maxRoundsPerModel = fileConfig.maxRoundsPerModel;
    }
    if (fileConfig.maxTotalTokens !== undefined) {
      config.maxTotalTokens = fileConfig.maxTotalTokens;
    }
    if (fileConfig.maxEstimatedCost !== undefined) {
      config.maxEstimatedCost = fileConfig.maxEstimatedCost;
    }
    if (fileConfig.apiTimeoutMs !== undefined) {
      config.apiTimeoutMs = fileConfig.apiTimeoutMs;
    }
    if (fileConfig.maxConcurrentJobs !== undefined) {
      config.maxConcurrentJobs = fileConfig.maxConcurrentJobs;
    }
    if (fileConfig.includeTranscripts !== undefined) {
      config.includeTranscripts = fileConfig.includeTranscripts;
    }
    if (fileConfig.retryOnTimeout !== undefined) {
      config.retryOnTimeout = fileConfig.retryOnTimeout;
    }
    if (fileConfig.forceUnlockReverts !== undefined) {
      config.forceUnlockReverts = fileConfig.forceUnlockReverts;
    }
    if (fileConfig.debug !== undefined) {
      config.debug = fileConfig.debug;
    }
    if (fileConfig.models) {
      config.models = { ...config.models, ...fileConfig.models };
    }
    if (fileConfig.prompts) {
      config.prompts = fileConfig.prompts;
    }
    if (fileConfig.fallbackPolicy) {
      config.fallbackPolicy = { ...config.fallbackPolicy, ...fileConfig.fallbackPolicy };
    }
    if (fileConfig.rateLimiting) {
      config.rateLimiting = { ...config.rateLimiting, ...fileConfig.rateLimiting };
    }
    if (fileConfig.costRates) {
      config.costRates = {
        claude: { ...config.costRates.claude, ...fileConfig.costRates.claude },
        chatgpt: { ...config.costRates.chatgpt, ...fileConfig.costRates.chatgpt },
        gemini: { ...config.costRates.gemini, ...fileConfig.costRates.gemini },
      };
    }
  }

  // Environment variable overrides
  if (process.env.DEBUG === 'true') {
    config.debug = true;
  }
  if (process.env.MAX_ROUNDS_PER_MODEL) {
    config.maxRoundsPerModel = parseInt(process.env.MAX_ROUNDS_PER_MODEL, 10);
  }
  if (process.env.MAX_TOTAL_TOKENS) {
    config.maxTotalTokens = parseInt(process.env.MAX_TOTAL_TOKENS, 10);
  }
  if (process.env.MAX_ESTIMATED_COST) {
    config.maxEstimatedCost = parseFloat(process.env.MAX_ESTIMATED_COST);
  }
  if (process.env.API_TIMEOUT_MS) {
    config.apiTimeoutMs = parseInt(process.env.API_TIMEOUT_MS, 10);
  }
  if (process.env.MAX_CONCURRENT_JOBS) {
    config.maxConcurrentJobs = parseInt(process.env.MAX_CONCURRENT_JOBS, 10);
  }

  return config;
}

export function mergeWithRuntimeConfig(
  baseConfig: GauntletConfig,
  runtimeConfig?: {
    maxRoundsPerModel?: number;
    maxTotalTokens?: number;
    maxEstimatedCost?: number;
    apiTimeoutMs?: number;
    includeTranscripts?: boolean;
    forceUnlockReverts?: boolean;
    models?: {
      claude?: string;
      chatgpt?: string;
      gemini?: string;
    };
  }
): GauntletConfig {
  if (!runtimeConfig) {
    return baseConfig;
  }

  return {
    ...baseConfig,
    maxRoundsPerModel: runtimeConfig.maxRoundsPerModel ?? baseConfig.maxRoundsPerModel,
    maxTotalTokens: runtimeConfig.maxTotalTokens ?? baseConfig.maxTotalTokens,
    maxEstimatedCost: runtimeConfig.maxEstimatedCost ?? baseConfig.maxEstimatedCost,
    apiTimeoutMs: runtimeConfig.apiTimeoutMs ?? baseConfig.apiTimeoutMs,
    includeTranscripts: runtimeConfig.includeTranscripts ?? baseConfig.includeTranscripts,
    forceUnlockReverts: runtimeConfig.forceUnlockReverts ?? baseConfig.forceUnlockReverts,
    models: {
      ...baseConfig.models,
      claude: runtimeConfig.models?.claude ?? baseConfig.models.claude,
      chatgpt: runtimeConfig.models?.chatgpt ?? baseConfig.models.chatgpt,
      gemini: runtimeConfig.models?.gemini ?? baseConfig.models.gemini,
    },
  };
}
