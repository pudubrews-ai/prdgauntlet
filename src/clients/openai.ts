// ============================================================================
// OpenAI API Client - ChatGPT Critic role
// ============================================================================

import OpenAI from 'openai';
import type { LLMClient, LLMMessage, LLMResponse } from '../types/index.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes per PRD v2.3.1

export class OpenAIClient implements LLMClient {
  private client: OpenAI;
  private modelId: string;
  private timeoutMs: number;

  constructor(apiKey: string, modelId: string = 'gpt-4o', timeoutMs?: number) {
    this.client = new OpenAI({ apiKey });
    this.modelId = modelId;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getModelId(): string {
    return this.modelId;
  }

  async chat(messages: LLMMessage[], systemPrompt: string): Promise<LLMResponse> {
    // Convert to OpenAI message format
    const openaiMessages: OpenAI.Chat.Completions.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...messages.map((m) => ({
        role: m.role as 'user' | 'assistant' | 'system',
        content: m.content,
      })),
    ];

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);

    try {
      const response = await this.client.chat.completions.create(
        {
          model: this.modelId,
          messages: openaiMessages,
          max_tokens: 8192,
        },
        { signal: controller.signal }
      );

      clearTimeout(timeoutId);

      const content = response.choices[0]?.message?.content ?? '';
      const usage = response.usage;

      return {
        content,
        usage: {
          inputTokens: usage?.prompt_tokens ?? 0,
          outputTokens: usage?.completion_tokens ?? 0,
        },
      };
    } catch (error) {
      clearTimeout(timeoutId);

      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error(`OpenAI API timeout after ${this.timeoutMs}ms`);
      }

      throw error;
    }
  }

  async validateModel(): Promise<boolean> {
    try {
      // Make a minimal API call to validate credentials and model
      const response = await this.client.chat.completions.create({
        model: this.modelId,
        messages: [{ role: 'user', content: 'ping' }],
        max_tokens: 10,
      });

      logger.logValidation(`chatgpt:${this.modelId}`, true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.logValidation(`chatgpt:${this.modelId}`, false, message);
      return false;
    }
  }
}
