// ============================================================================
// Claude API Client - Defender role
// ============================================================================

import Anthropic from '@anthropic-ai/sdk';
import type { LLMClient, LLMMessage, LLMResponse } from '../types/index.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes per PRD v2.3.1

export class ClaudeClient implements LLMClient {
  private client: Anthropic;
  private modelId: string;
  private timeoutMs: number;

  constructor(apiKey: string, modelId: string = 'claude-sonnet-4-5-20250929', timeoutMs?: number) {
    this.client = new Anthropic({ apiKey });
    this.modelId = modelId;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getModelId(): string {
    return this.modelId;
  }

  async chat(messages: LLMMessage[], systemPrompt: string): Promise<LLMResponse> {
    // Convert to Anthropic message format
    const anthropicMessages = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content,
      }));

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.messages.create(
        {
          model: this.modelId,
          max_tokens: 8192,
          system: systemPrompt,
          messages: anthropicMessages,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      // Extract text content
      const textContent = response.content.find((c) => c.type === 'text');
      const content = textContent?.type === 'text' ? textContent.text : '';

      return {
        content,
        usage: {
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`Claude API timeout after ${this.timeoutMs}ms`);
      }

      throw error;
    }
  }

  async validateModel(): Promise<boolean> {
    try {
      // Make a minimal API call to validate credentials and model
      const response = await this.client.messages.create({
        model: this.modelId,
        max_tokens: 10,
        messages: [{ role: 'user', content: 'ping' }],
      });

      logger.logValidation(`claude:${this.modelId}`, true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.logValidation(`claude:${this.modelId}`, false, message);
      return false;
    }
  }
}
