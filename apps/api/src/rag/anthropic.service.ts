import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Anthropic from '@anthropic-ai/sdk';
import { PrismaService } from '../prisma/prisma.service';

interface GenerateStructuredResponseParams {
  systemPrompt: string;
  userPrompt: string;
  maxTokens?: number;
}

interface AnthropicResponse<T> {
  data: T;
  promptTokens: number;
  completionTokens: number;
  durationMs: number;
}

@Injectable()
export class AnthropicService {
  private readonly logger = new Logger(AnthropicService.name);
  private readonly client: Anthropic | null;
  private readonly model = 'claude-sonnet-4-20250514';

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {
    const apiKey = this.config.get<string>('ANTHROPIC_API_KEY');
    if (apiKey) {
      this.client = new Anthropic({ apiKey });
      this.logger.log('Anthropic client initialized');
    } else {
      this.client = null;
      this.logger.warn('ANTHROPIC_API_KEY not configured — AnthropicService will be unavailable');
    }
  }

  /**
   * Check if the Anthropic client is available
   */
  isAvailable(): boolean {
    return this.client !== null;
  }

  /**
   * Generate a structured JSON response from Claude
   */
  async generateStructuredResponse<T>(
    params: GenerateStructuredResponseParams,
    options?: {
      courseId?: string;
      userId?: string;
      action?: string;
    },
  ): Promise<AnthropicResponse<T>> {
    if (!this.client) {
      throw new Error('Anthropic client not configured. Please set ANTHROPIC_API_KEY.');
    }

    const { systemPrompt, userPrompt, maxTokens = 4096 } = params;
    const startTime = Date.now();

    try {
      const response = await this.client.messages.create({
        model: this.model,
        max_tokens: maxTokens,
        messages: [
          {
            role: 'user',
            content: userPrompt,
          },
        ],
        system: systemPrompt,
      });

      const durationMs = Date.now() - startTime;

      // Extract text content from response
      const textContent = response.content.find((block) => block.type === 'text');
      if (!textContent || textContent.type !== 'text') {
        throw new Error('No text content in Anthropic response');
      }

      // Parse JSON response
      const rawText = textContent.text.trim();
      const data = this.parseJsonResponse<T>(rawText);

      const result: AnthropicResponse<T> = {
        data,
        promptTokens: response.usage.input_tokens,
        completionTokens: response.usage.output_tokens,
        durationMs,
      };

      // Log to audit system if courseId and userId provided
      if (options?.courseId && options?.userId) {
        await this.createAuditLog({
          courseId: options.courseId,
          userId: options.userId,
          action: options.action || 'anthropic_generate',
          model: this.model,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          durationMs,
          inputPayload: {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
          },
          outputPayload: {
            responseLength: rawText.length,
          },
        });
      }

      this.logger.log(
        `Anthropic response: ${result.promptTokens} prompt + ${result.completionTokens} completion tokens in ${durationMs}ms`,
      );

      return result;
    } catch (error: any) {
      const durationMs = Date.now() - startTime;

      // Handle specific Anthropic errors
      if (error instanceof Anthropic.APIError) {
        if (error.status === 429) {
          this.logger.error('Anthropic rate limit exceeded', error.message);
          throw new Error('Rate limit exceeded. Please try again later.');
        }
        if (error.status === 401) {
          this.logger.error('Anthropic authentication failed', error.message);
          throw new Error('Invalid Anthropic API key.');
        }
        if (error.status === 408 || error.message?.includes('timeout')) {
          this.logger.error('Anthropic request timeout', error.message);
          throw new Error('Request timed out. Please try again.');
        }
      }

      // Log error to audit system if courseId and userId provided
      if (options?.courseId && options?.userId) {
        await this.createAuditLog({
          courseId: options.courseId,
          userId: options.userId,
          action: options.action || 'anthropic_generate',
          model: this.model,
          promptTokens: 0,
          completionTokens: 0,
          durationMs,
          inputPayload: {
            systemPromptLength: systemPrompt.length,
            userPromptLength: userPrompt.length,
          },
          outputPayload: {},
          errorMessage: error.message || 'Unknown error',
        });
      }

      this.logger.error(`Anthropic API error: ${error.message}`, error.stack);
      throw error;
    }
  }

  /**
   * Parse JSON from response, handling markdown fences
   */
  private parseJsonResponse<T>(rawText: string): T {
    let jsonStr = rawText;

    // Strip markdown fences if present
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) {
      jsonStr = fenceMatch[1]!.trim();
    }

    try {
      return JSON.parse(jsonStr) as T;
    } catch (parseError: any) {
      this.logger.error(`Failed to parse JSON response: ${parseError.message}`);
      this.logger.debug(`Raw response: ${rawText.slice(0, 500)}...`);
      throw new Error(`Invalid JSON response from Claude: ${parseError.message}`);
    }
  }

  /**
   * Create an audit log entry for LLM calls
   */
  private async createAuditLog(data: {
    courseId: string;
    userId: string;
    action: string;
    model: string;
    promptTokens: number;
    completionTokens: number;
    durationMs: number;
    inputPayload?: any;
    outputPayload?: any;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.prisma.llmAuditLog.create({ data });
    } catch (err) {
      this.logger.error('Failed to create audit log', err);
    }
  }
}
