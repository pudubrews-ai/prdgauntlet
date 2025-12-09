// ============================================================================
// Model Validator - Startup and runtime validation (FR9)
// ============================================================================

import type { GauntletConfig, ValidationResult, ModelName } from '../types/index.js';
import { ClaudeClient } from './claude.js';
import { OpenAIClient } from './openai.js';
import { GeminiClient } from './gemini.js';
import { logger } from '../utils/logger.js';

export interface ValidationCache {
  claude: ValidationResult;
  chatgpt: ValidationResult;
  gemini: ValidationResult;
  lastRefresh: string;
}

let validationCache: ValidationCache | null = null;

export async function validateModel(
  model: ModelName,
  config: GauntletConfig,
  retryOnTimeout: boolean = true
): Promise<ValidationResult> {
  const timestamp = new Date().toISOString();

  const createResult = (valid: boolean, error?: string): ValidationResult => ({
    model,
    modelId: getModelId(model, config),
    valid,
    error,
    timestamp,
  });

  try {
    let client;
    switch (model) {
      case 'claude':
        client = new ClaudeClient(config.anthropicApiKey, config.models.claude);
        break;
      case 'chatgpt':
        client = new OpenAIClient(config.openaiApiKey, config.models.chatgpt);
        break;
      case 'gemini':
        client = new GeminiClient(config.googleApiKey, config.models.gemini);
        break;
    }

    const valid = await client.validateModel();
    return createResult(valid, valid ? undefined : 'Validation failed');
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    const isTimeout = message.includes('timeout');

    // Retry once on timeout if configured
    if (isTimeout && retryOnTimeout) {
      logger.logWarn(`Retrying ${model} validation after timeout`);
      return validateModel(model, config, false);
    }

    return createResult(false, message);
  }
}

function getModelId(model: ModelName, config: GauntletConfig): string {
  switch (model) {
    case 'claude':
      return config.models.claude;
    case 'chatgpt':
      return config.models.chatgpt;
    case 'gemini':
      return config.models.gemini;
  }
}

export async function validateAllModels(config: GauntletConfig): Promise<ValidationCache> {
  logger.logInfo('Validating all models...');

  const [claude, chatgpt, gemini] = await Promise.all([
    validateModel('claude', config, config.retryOnTimeout),
    validateModel('chatgpt', config, config.retryOnTimeout),
    validateModel('gemini', config, config.retryOnTimeout),
  ]);

  validationCache = {
    claude,
    chatgpt,
    gemini,
    lastRefresh: new Date().toISOString(),
  };

  // Log summary
  const validCount = [claude, chatgpt, gemini].filter((r) => r.valid).length;
  logger.logInfo(`Model validation complete: ${validCount}/3 models valid`);

  return validationCache;
}

export function getValidationCache(): ValidationCache | null {
  return validationCache;
}

export function clearValidationCache(): void {
  validationCache = null;
}

export async function refreshValidation(config: GauntletConfig): Promise<ValidationCache> {
  return validateAllModels(config);
}

export function isModelAvailable(model: ModelName): boolean {
  if (!validationCache) {
    return false;
  }
  return validationCache[model].valid;
}

export function getValidationStatus(): 'healthy' | 'degraded' | 'unhealthy' {
  if (!validationCache) {
    return 'unhealthy';
  }

  const validCount = [
    validationCache.claude.valid,
    validationCache.chatgpt.valid,
    validationCache.gemini.valid,
  ].filter(Boolean).length;

  if (validCount === 3) return 'healthy';
  if (validCount >= 1 && validationCache.claude.valid) return 'degraded';
  return 'unhealthy';
}
