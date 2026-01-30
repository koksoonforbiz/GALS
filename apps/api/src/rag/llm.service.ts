import { Injectable, Logger, NotFoundException, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { ChunkWithScore, RagService } from './rag.service';
import * as crypto from 'crypto';

interface GenerateRagAnswerInput {
  courseId: string;
  userId: string;
  query: string;
  chunks: ChunkWithScore[];
  strictSource: boolean;
}

interface GenerateContentDraftInput {
  courseId: string;
  userId: string;
  title: string;
  prompt: string;
  chunks: ChunkWithScore[];
  strictSource: boolean;
}

interface LlmResponse {
  answer: string;
  citations: Array<{
    chunkId: string;
    documentTitle: string;
    pageNumber: number | null;
    quote: string;
  }>;
  strictSourceValid: boolean;
  notEnoughInfo: boolean;
  model: string;
  promptTokens: number;
  completionTokens: number;
}

interface UserLlmSettings {
  provider: string | null;
  model: string | null;
  hasKey: boolean;
}

// Simple symmetric encryption for storing API keys at rest
const ENCRYPTION_ALGO = 'aes-256-gcm';

@Injectable()
export class LlmService {
  private readonly logger = new Logger(LlmService.name);
  private readonly encryptionKey: Buffer;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
    private readonly ragService: RagService,
  ) {
    // Derive a 32-byte key from JWT_SECRET for encrypting stored API keys
    const secret = this.config.get<string>('JWT_SECRET', 'dev-secret-change-in-production');
    this.encryptionKey = crypto.scryptSync(secret, 'llm-key-salt', 32);
  }

  // ─── API Key Management ─────────────────────────────────

  private encrypt(text: string): string {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ENCRYPTION_ALGO, this.encryptionKey, iv);
    const encrypted = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()]);
    const authTag = cipher.getAuthTag();
    // Store as iv:authTag:encrypted (all hex)
    return `${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted.toString('hex')}`;
  }

  private decrypt(data: string): string {
    const [ivHex, authTagHex, encryptedHex] = data.split(':');
    const iv = Buffer.from(ivHex, 'hex');
    const authTag = Buffer.from(authTagHex, 'hex');
    const encrypted = Buffer.from(encryptedHex, 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  async saveApiKey(userId: string, provider: string, apiKey: string, model?: string) {
    const encrypted = this.encrypt(apiKey);
    const defaultModel = provider === 'openai' ? 'gpt-4o-mini' : 'gpt-4o-mini';

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        llmProvider: provider,
        encryptedApiKey: encrypted,
        llmModel: model || defaultModel,
      },
    });

    return { saved: true, provider, model: model || defaultModel };
  }

  async removeApiKey(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        llmProvider: null,
        encryptedApiKey: null,
        llmModel: null,
      },
    });
    return { removed: true };
  }

  async getUserLlmSettings(userId: string): Promise<UserLlmSettings> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { llmProvider: true, llmModel: true, encryptedApiKey: true },
    });
    return {
      provider: user?.llmProvider || null,
      model: user?.llmModel || null,
      hasKey: !!user?.encryptedApiKey,
    };
  }

  private async getUserApiKey(userId: string): Promise<{ apiKey: string; model: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { llmProvider: true, llmModel: true, encryptedApiKey: true },
    });
    if (!user?.encryptedApiKey) return null;
    try {
      const apiKey = this.decrypt(user.encryptedApiKey);
      return { apiKey, model: user.llmModel || 'gpt-4o-mini' };
    } catch {
      this.logger.error(`Failed to decrypt API key for user ${userId}`);
      return null;
    }
  }

  // ─── RAG Answer Generation ─────────────────────────────

  async generateRagAnswer(input: GenerateRagAnswerInput): Promise<LlmResponse> {
    const startTime = Date.now();

    if (input.chunks.length === 0) {
      return this.noSourcesResponse(input);
    }

    const contextBlock = this.buildContextBlock(input.chunks);
    const systemPrompt = this.buildRagSystemPrompt(input.strictSource);
    const userPrompt = `${contextBlock}\n\n---\n\nQuestion: ${input.query}`;

    const credentials = await this.getUserApiKey(input.userId);
    const result = await this.callLlm(systemPrompt, userPrompt, credentials);

    const citations = this.extractCitations(result.content, input.chunks);

    let strictSourceValid = true;
    let notEnoughInfo = false;

    if (input.strictSource) {
      const validation = this.ragService.validateCitations(
        result.content,
        citations,
        input.chunks,
      );
      strictSourceValid = validation.valid;

      if (
        result.content.includes('NOT_ENOUGH_INFO') ||
        result.content.includes('insufficient sources')
      ) {
        notEnoughInfo = true;
      }
    }

    const durationMs = Date.now() - startTime;
    const modelUsed = credentials?.model || 'template';

    await this.createAuditLog({
      courseId: input.courseId,
      userId: input.userId,
      action: 'query_rag',
      model: modelUsed,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      durationMs,
      inputPayload: {
        query: input.query,
        chunkCount: input.chunks.length,
        strictSource: input.strictSource,
      },
      outputPayload: {
        answerLength: result.content.length,
        citationCount: citations.length,
        strictSourceValid,
        notEnoughInfo,
      },
    });

    return {
      answer: result.content,
      citations,
      strictSourceValid,
      notEnoughInfo,
      model: modelUsed,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
    };
  }

  // ─── Content Draft Generation ──────────────────────────

  async generateContentDraft(input: GenerateContentDraftInput) {
    const startTime = Date.now();

    if (input.chunks.length === 0 && input.strictSource) {
      const draft = await this.prisma.contentDraft.create({
        data: {
          courseId: input.courseId,
          createdById: input.userId,
          title: input.title,
          contentMdx:
            '> **NOT_ENOUGH_INFO**: No source documents are available for this course. Please upload reference materials first.',
          citations: [],
          status: 'DRAFT',
        },
      });
      return { draft, notEnoughInfo: true, debugInfo: {} };
    }

    const contextBlock = this.buildContextBlock(input.chunks);
    const systemPrompt = this.buildContentGenerationPrompt(input.strictSource);
    const userPrompt = `${contextBlock}\n\n---\n\nGenerate course content for: "${input.title}"\n\nTeacher instructions: ${input.prompt}`;

    const credentials = await this.getUserApiKey(input.userId);
    const result = await this.callLlm(systemPrompt, userPrompt, credentials);

    const citations = this.extractCitations(result.content, input.chunks);

    let strictSourceValid = true;
    let notEnoughInfo = false;

    if (input.strictSource) {
      const validation = this.ragService.validateCitations(
        result.content,
        citations,
        input.chunks,
      );
      strictSourceValid = validation.valid;
      notEnoughInfo =
        result.content.includes('NOT_ENOUGH_INFO') ||
        result.content.includes('insufficient sources');
    }

    const durationMs = Date.now() - startTime;
    const modelUsed = credentials?.model || 'template';

    const draft = await this.prisma.contentDraft.create({
      data: {
        courseId: input.courseId,
        createdById: input.userId,
        title: input.title,
        contentMdx: result.content,
        citations: citations as any,
        status: 'DRAFT',
      },
    });

    await this.createAuditLog({
      draftId: draft.id,
      courseId: input.courseId,
      userId: input.userId,
      action: 'generate_content',
      model: modelUsed,
      promptTokens: result.promptTokens,
      completionTokens: result.completionTokens,
      durationMs,
      inputPayload: {
        title: input.title,
        prompt: input.prompt,
        chunkCount: input.chunks.length,
        strictSource: input.strictSource,
      },
      outputPayload: {
        draftId: draft.id,
        contentLength: result.content.length,
        citationCount: citations.length,
        strictSourceValid,
        notEnoughInfo,
      },
    });

    return {
      draft,
      citations,
      strictSourceValid,
      notEnoughInfo,
      debugInfo: {
        model: modelUsed,
        promptTokens: result.promptTokens,
        completionTokens: result.completionTokens,
        durationMs,
        chunksUsed: input.chunks.map((c) => ({
          id: c.id,
          documentTitle: c.documentTitle,
          pageNumber: c.pageNumber,
          rerankerScore: c.rerankerScore,
        })),
      },
    };
  }

  // ─── Draft Management ──────────────────────────────────

  async listDrafts(courseId: string) {
    return this.prisma.contentDraft.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        title: true,
        status: true,
        version: true,
        createdAt: true,
        reviewedAt: true,
        createdBy: { select: { id: true, name: true } },
      },
    });
  }

  async getDraft(draftId: string) {
    const draft = await this.prisma.contentDraft.findUnique({
      where: { id: draftId },
      include: {
        createdBy: { select: { id: true, name: true } },
        auditLogs: {
          orderBy: { createdAt: 'desc' },
          take: 5,
          select: {
            id: true,
            action: true,
            model: true,
            promptTokens: true,
            completionTokens: true,
            durationMs: true,
            createdAt: true,
          },
        },
      },
    });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);
    return draft;
  }

  async approveDraft(draftId: string, userId: string, editedContent?: string) {
    const draft = await this.prisma.contentDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);

    return this.prisma.contentDraft.update({
      where: { id: draftId },
      data: {
        status: 'APPROVED',
        reviewedAt: new Date(),
        contentMdx: editedContent || draft.contentMdx,
      },
    });
  }

  async rejectDraft(draftId: string, userId: string) {
    const draft = await this.prisma.contentDraft.findUnique({ where: { id: draftId } });
    if (!draft) throw new NotFoundException(`Draft ${draftId} not found`);

    return this.prisma.contentDraft.update({
      where: { id: draftId },
      data: {
        status: 'REJECTED',
        reviewedAt: new Date(),
      },
    });
  }

  // ─── Audit Logs ────────────────────────────────────────

  async getAuditLogs(courseId: string, limit: number = 50) {
    return this.prisma.llmAuditLog.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        action: true,
        model: true,
        promptTokens: true,
        completionTokens: true,
        durationMs: true,
        errorMessage: true,
        createdAt: true,
        draft: { select: { id: true, title: true } },
      },
    });
  }

  // ─── Private Helpers ───────────────────────────────────

  private async callLlm(
    systemPrompt: string,
    userPrompt: string,
    credentials: { apiKey: string; model: string } | null,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    if (credentials) {
      return this.callOpenAiApi(systemPrompt, userPrompt, credentials.apiKey, credentials.model);
    }
    // Fallback: built-in template-based generation (no API key configured)
    return this.generateWithoutApi(systemPrompt, userPrompt);
  }

  private async callOpenAiApi(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    model: string,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    try {
      const response = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          max_tokens: 4096,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`OpenAI API error: ${response.status} ${errorText}`);
        throw new Error(`OpenAI API error: ${response.status}`);
      }

      const data = await response.json();
      return {
        content: data.choices?.[0]?.message?.content || '',
        promptTokens: data.usage?.prompt_tokens || 0,
        completionTokens: data.usage?.completion_tokens || 0,
      };
    } catch (error) {
      this.logger.error('Failed to call OpenAI API', error);
      // Fallback to template-based generation
      return this.generateWithoutApi(systemPrompt, userPrompt);
    }
  }

  private async generateWithoutApi(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    const sourceMatch = userPrompt.match(/Source \d+[\s\S]*?(?=---|\z)/g);
    const questionMatch = userPrompt.match(/Question:\s*(.*)/);
    const generateMatch = userPrompt.match(/Generate course content for:\s*"([^"]+)"/);
    const instructionsMatch = userPrompt.match(/Teacher instructions:\s*([\s\S]*?)$/);

    let content = '';

    if (generateMatch) {
      const title = generateMatch[1];
      const instructions = instructionsMatch?.[1]?.trim() || '';
      content = this.buildTemplateContent(title, instructions, sourceMatch || []);
    } else if (questionMatch) {
      const question = questionMatch[1];
      content = this.buildTemplateAnswer(question, sourceMatch || []);
    } else {
      content =
        '> **NOT_ENOUGH_INFO**: Unable to process the request. Please provide a clear question or generation prompt.';
    }

    return {
      content,
      promptTokens: Math.ceil(userPrompt.length / 4),
      completionTokens: Math.ceil(content.length / 4),
    };
  }

  private buildTemplateContent(
    title: string,
    instructions: string,
    sources: string[],
  ): string {
    if (sources.length === 0) {
      return `> **NOT_ENOUGH_INFO**: No source documents available to generate content for "${title}". Please upload reference materials and try again.`;
    }

    const sourceTexts = sources.map((s) => {
      const contentMatch = s.match(/Content:\s*([\s\S]*?)(?=\n\n|$)/);
      return contentMatch?.[1]?.trim() || s;
    });

    const combinedInfo = sourceTexts.join('\n\n');
    const preview = combinedInfo.slice(0, 2000);

    let mdx = `# ${title}\n\n`;
    mdx += `${instructions ? `*Based on instructions: ${instructions}*\n\n` : ''}`;
    mdx += `## Overview\n\n`;
    mdx += `This content was generated from ${sources.length} source document(s). `;
    mdx += `Each section below is grounded in the uploaded reference materials. [1]\n\n`;
    mdx += `## Key Concepts\n\n`;

    const sentences = preview
      .split(/[.!?]+/)
      .filter((s) => s.trim().length > 20)
      .slice(0, 6);

    sentences.forEach((sentence, i) => {
      const citationNum = Math.min(i + 1, sources.length);
      mdx += `- ${sentence.trim()}. [${citationNum}]\n`;
    });

    mdx += `\n## Summary\n\n`;
    mdx += `The above content is derived from the uploaded source materials. `;
    mdx += `Please review this draft carefully before approving. [1]\n`;
    mdx += `\n---\n*This is an AI-generated DRAFT. Review and approve before publishing.*\n`;

    return mdx;
  }

  private buildTemplateAnswer(question: string, sources: string[]): string {
    if (sources.length === 0) {
      return `> **NOT_ENOUGH_INFO**: No source documents available to answer "${question}". Please upload reference materials first.`;
    }

    const sourceTexts = sources.map((s) => {
      const contentMatch = s.match(/Content:\s*([\s\S]*?)(?=\n\n|$)/);
      return contentMatch?.[1]?.trim() || s;
    });

    const combinedInfo = sourceTexts.join(' ').slice(0, 1500);

    let answer = `Based on the available source documents:\n\n`;
    answer += `${combinedInfo.slice(0, 500)}... [1]\n\n`;
    answer += `This answer is derived from ${sources.length} source chunk(s). [1]`;

    return answer;
  }

  private buildContextBlock(chunks: ChunkWithScore[]): string {
    return chunks
      .map(
        (chunk, i) =>
          `Source ${i + 1} (from "${chunk.documentTitle}", page ${chunk.pageNumber ?? 'N/A'}):\n` +
          `Content: ${chunk.content}`,
      )
      .join('\n\n');
  }

  private buildRagSystemPrompt(strictSource: boolean): string {
    let prompt = `You are an educational content assistant. Answer questions using ONLY the provided source documents.

Rules:
- Cite sources using [N] notation where N is the source number
- Every factual claim must have a citation
- Include page numbers when available`;

    if (strictSource) {
      prompt += `
- STRICT SOURCE MODE: Every paragraph MUST have at least one citation [N]
- If sources are insufficient to answer the question, respond with: "NOT_ENOUGH_INFO: The provided sources do not contain sufficient information to answer this question. Consider uploading additional materials about: [suggest topics]"
- NEVER invent information not found in the sources`;
    }

    return prompt;
  }

  private buildContentGenerationPrompt(strictSource: boolean): string {
    let prompt = `You are an educational content creator. Generate course material in MDX format using the provided source documents.

Rules:
- Output well-structured MDX with headings (##), lists, and emphasis
- Cite sources using [N] notation matching the source numbers
- Every paragraph must reference its source
- Use KaTeX for math: $inline$ or $$block$$
- Write for university-level students`;

    if (strictSource) {
      prompt += `
- STRICT SOURCE MODE: ONLY include information that can be directly traced to the sources
- Every paragraph MUST have at least one citation [N]
- If sources are insufficient, begin your response with: "NOT_ENOUGH_INFO: insufficient sources to generate content about [topic]. Please upload materials covering: [suggestions]"`;
    }

    prompt += `
- This will be a DRAFT for teacher review. Mark it clearly as AI-generated.`;

    return prompt;
  }

  private extractCitations(
    content: string,
    chunks: ChunkWithScore[],
  ): Array<{
    chunkId: string;
    documentTitle: string;
    pageNumber: number | null;
    quote: string;
  }> {
    const citationPattern = /\[(\d+)\]/g;
    const citedNumbers = new Set<number>();
    let match;

    while ((match = citationPattern.exec(content)) !== null) {
      citedNumbers.add(parseInt(match[1], 10));
    }

    return Array.from(citedNumbers)
      .filter((n) => n >= 1 && n <= chunks.length)
      .map((n) => {
        const chunk = chunks[n - 1];
        return {
          chunkId: chunk.id,
          documentTitle: chunk.documentTitle,
          pageNumber: chunk.pageNumber,
          quote: chunk.content.slice(0, 100),
        };
      });
  }

  private noSourcesResponse(input: GenerateRagAnswerInput): LlmResponse {
    return {
      answer:
        '> **NOT_ENOUGH_INFO**: No source documents have been indexed for this course. Please upload reference materials in the Sources tab first.',
      citations: [],
      strictSourceValid: false,
      notEnoughInfo: true,
      model: 'none',
      promptTokens: 0,
      completionTokens: 0,
    };
  }

  private async createAuditLog(data: {
    draftId?: string;
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
  }) {
    try {
      await this.prisma.llmAuditLog.create({ data });
    } catch (err) {
      this.logger.error('Failed to create audit log', err);
    }
  }
}
