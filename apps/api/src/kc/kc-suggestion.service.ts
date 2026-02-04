import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  buildKcExtractionSystemPrompt,
  buildKcExtractionUserPrompt,
} from './kc-suggestion-prompts';

interface KcExtractionInput {
  courseId: string;
  pageId: string;
  moduleTitle: string;
  courseTitle: string;
  pageTitle: string;
  contentJson: string;
  generationJobId: string;
  userId: string;
}

interface ProposedKcRaw {
  name: string;
  description?: string;
  confidenceLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  evidence: {
    blockIds: string[];
  };
}

@Injectable()
export class KcSuggestionService {
  private readonly logger = new Logger(KcSuggestionService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Extract and store proposed KCs from generated page content.
   * This is fire-and-forget — errors are logged but never thrown.
   */
  async suggestKcsForPage(input: KcExtractionInput): Promise<void> {
    try {
      // 1. Get LLM credentials
      const credentials = await this.getLlmCredentials(input.userId);
      if (!credentials) {
        this.logger.warn('No LLM credentials for KC suggestion — skipping');
        return;
      }

      // 2. Build prompts
      const systemPrompt = buildKcExtractionSystemPrompt();
      const userPrompt = buildKcExtractionUserPrompt(
        input.courseTitle,
        input.moduleTitle,
        input.pageTitle,
        input.contentJson,
      );

      // 3. Call LLM
      const llmResult = await this.callOpenAiApi(
        systemPrompt,
        userPrompt,
        credentials.apiKey,
        credentials.model,
      );

      // 4. Parse response
      const proposed = this.parseKcResponse(llmResult);
      if (proposed.length === 0) {
        this.logger.log('No KCs extracted from page content');
        return;
      }

      this.logger.log(`Extracted ${proposed.length} proposed KCs for page "${input.pageTitle}"`);

      // 5. Lightweight dedup against existing KCs in this course
      const existing = await this.prisma.proposedKC.findMany({
        where: { courseId: input.courseId },
        select: { id: true, name: true },
      });

      // 6. Save each proposed KC
      for (const kc of proposed) {
        const duplicate = this.findSimilarKc(kc.name, existing);

        await this.prisma.proposedKC.create({
          data: {
            courseId: input.courseId,
            name: kc.name,
            description: kc.description || null,
            status: 'PROPOSED',
            confidenceLevel: kc.confidenceLevel || 'MEDIUM',
            createdBy: 'ai',
            generationJobId: input.generationJobId,
            relatedToKCId: duplicate?.id || null,
            evidence: {
              pageId: input.pageId,
              blockIds: kc.evidence?.blockIds || [],
            } as unknown as any,
            pageIds: [input.pageId],
          },
        });
      }

      this.logger.log(
        `Saved ${proposed.length} proposed KCs for course ${input.courseId}, page ${input.pageId}`,
      );
    } catch (err: any) {
      // Non-blocking: log and continue silently
      this.logger.error(`KC suggestion failed for page ${input.pageId}: ${err.message}`, err.stack);
    }
  }

  // ─── Private: Parse LLM response ────────────────────────

  private parseKcResponse(raw: string): ProposedKcRaw[] {
    try {
      let jsonStr = raw.trim();
      const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) jsonStr = fenceMatch[1]!.trim();

      const parsed = JSON.parse(jsonStr);
      const kcs = parsed.proposedKCs || parsed.proposed_kcs || parsed.kcs || [];

      if (!Array.isArray(kcs)) return [];

      return kcs.filter(
        (kc: any) => kc && typeof kc.name === 'string' && kc.name.trim().length > 0,
      );
    } catch (err: any) {
      this.logger.error(`Failed to parse KC extraction response: ${err.message}`);
      return [];
    }
  }

  // ─── Private: Lightweight dedup ──────────────────────────

  private findSimilarKc(
    name: string,
    existing: Array<{ id: string; name: string }>,
  ): { id: string; name: string } | null {
    const normalized = name.toLowerCase().trim();

    for (const kc of existing) {
      const existingNorm = kc.name.toLowerCase().trim();

      // Exact match
      if (existingNorm === normalized) return kc;

      // High similarity: one is substring of the other
      if (existingNorm.includes(normalized) || normalized.includes(existingNorm)) {
        return kc;
      }

      // Simple word overlap ratio
      const wordsA = new Set(normalized.split(/\s+/));
      const wordsB = new Set(existingNorm.split(/\s+/));
      const intersection = [...wordsA].filter((w) => wordsB.has(w));
      const union = new Set([...wordsA, ...wordsB]);
      const jaccard = intersection.length / union.size;
      if (jaccard >= 0.7) return kc;
    }

    return null;
  }

  // ─── Private: LLM ───────────────────────────────────────

  private async getLlmCredentials(
    userId: string,
  ): Promise<{ apiKey: string; model: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { llmProvider: true, llmModel: true, encryptedApiKey: true },
    });
    if (!user?.encryptedApiKey) return null;
    try {
      const apiKey = this.decryptApiKey(user.encryptedApiKey);
      return { apiKey, model: user.llmModel || 'gpt-4o-mini' };
    } catch {
      return null;
    }
  }

  private decryptApiKey(encrypted: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
    const key = crypto.scryptSync(secret, 'llm-key-salt', 32);
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0]!, 'hex');
    const authTag = Buffer.from(parts[1]!, 'hex');
    const encryptedBuf = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encryptedBuf) + decipher.final('utf8');
  }

  private async callOpenAiApi(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    model: string,
  ): Promise<string> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.3,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`OpenAI API error (${response.status}): ${errorText}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
    };
    return data.choices?.[0]?.message?.content || '';
  }
}
