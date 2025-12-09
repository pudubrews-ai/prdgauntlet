// ============================================================================
// Google Gemini API Client - Gemini Critic role
// ============================================================================

import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import type { LLMClient, LLMMessage, LLMResponse } from '../types/index.js';
import { logger } from '../utils/logger.js';

const DEFAULT_TIMEOUT_MS = 600_000; // 10 minutes per PRD v2.3.1

export class GeminiClient implements LLMClient {
  private client: GoogleGenerativeAI;
  private modelId: string;
  private timeoutMs: number;

  constructor(apiKey: string, modelId: string = 'gemini-1.5-pro', timeoutMs?: number) {
    this.client = new GoogleGenerativeAI(apiKey);
    this.modelId = modelId;
    this.timeoutMs = timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  getModelId(): string {
    return this.modelId;
  }

  async chat(messages: LLMMessage[], systemPrompt: string): Promise<LLMResponse> {
    const model = this.client.getGenerativeModel({
      model: this.modelId,
      systemInstruction: systemPrompt,
      safetySettings: [
        {
          category: HarmCategory.HARM_CATEGORY_HARASSMENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_HATE_SPEECH,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_SEXUALLY_EXPLICIT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
        {
          category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
          threshold: HarmBlockThreshold.BLOCK_NONE,
        },
      ],
    });

    // Convert to Gemini history format
    const history = messages.slice(0, -1).map((m) => ({
      role: m.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: m.content }],
    }));

    const lastMessage = messages[messages.length - 1];

    const chat = model.startChat({
      history: history as Array<{ role: 'user' | 'model'; parts: Array<{ text: string }> }>,
    });

    // Create a timeout promise
    const timeoutPromise = new Promise<never>((_, reject) => {
      setTimeout(() => reject(new Error(`Gemini API timeout after ${this.timeoutMs}ms`)), this.timeoutMs);
    });

    try {
      const result = await Promise.race([
        chat.sendMessage(lastMessage?.content ?? ''),
        timeoutPromise,
      ]);

      const response = result.response;
      const content = response.text();
      const usage = response.usageMetadata;

      return {
        content,
        usage: {
          inputTokens: usage?.promptTokenCount ?? 0,
          outputTokens: usage?.candidatesTokenCount ?? 0,
        },
      };
    } catch (error) {
      if (error instanceof Error && error.message.includes('timeout')) {
        throw error;
      }
      throw error;
    }
  }

  async validateModel(): Promise<boolean> {
    try {
      const model = this.client.getGenerativeModel({ model: this.modelId });
      const result = await model.generateContent('ping');
      result.response.text(); // Ensure we can read the response

      logger.logValidation(`gemini:${this.modelId}`, true);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      logger.logValidation(`gemini:${this.modelId}`, false, message);
      return false;
    }
  }
}
