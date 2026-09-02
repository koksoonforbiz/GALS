import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { ChunkWithScore, RagService } from './rag.service';
import { calculateCost } from '../user-management/llm-cost-calculator';
import {
  getChatModel,
  getEmbeddingModel,
  isSelectable,
  defaultChatModel,
  defaultEmbeddingModel,
  type ChatModelSpec,
  type LlmProvider,
} from '../llm/model-registry';
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
  embeddingModel: string | null;
  hasKey: boolean;
  // Stage 04 (RAG) — Cohere Rerank API key presence flag. The
  // AiSettingsPage uses this to render the "Cohere key configured"
  // status without sending the (encrypted) key back to the browser.
  hasCohereKey: boolean;
}

// ─── Funnel call-shape types (Stage 3) ──────────────────────
//
// The funnel accepts a normalized request and shapes it per the
// resolved ChatModelSpec. Every chat call site (including the 6 ex-
// bypasses refactored in Stage 3.2) goes through `callLlmForUser`.
//
// `content` may be a plain string OR an OpenAI-style content-part
// array (the multimodal page-content path uses parts). Under Gemini
// the funnel translates: text parts → `parts: [{ text }]`; OpenAI
// file parts → either the cached file_id reference (if the spec says
// `supportsOpenAiFilesApi`) or are silently dropped (the caller is
// expected to pre-substitute the chunked-text RAG fallback — see
// Stage 3.5).

export type FunnelTextPart = { type: 'text'; text: string };
export type FunnelFilePartByOpenAiId = {
  type: 'file';
  file: { file_id: string };
};
export type FunnelFilePartInline = {
  type: 'file';
  file: { filename: string; file_data: string };
};
/**
 * Stage 05 — Multimodal image content for the VLM caption flow (and
 * any future image-input call site, e.g. an interventions surface
 * that wants to ask "explain this chart"). Uses the OpenAI-style
 * `image_url` shape with a base64 data URL so the same part type
 * works for both OpenAI (passed straight through) and Gemini
 * (translated to `inlineData` in `callGeminiApi`).
 *
 * `url` MUST be a data URL — `data:image/png;base64,...` — because
 * the caller is the rasterizer (we already have the bytes); we
 * intentionally don't accept remote URLs to keep the surface tiny
 * and the caching story explicit (caller decides what to embed).
 */
export type FunnelImageUrlPart = {
  type: 'image_url';
  image_url: { url: string };
};
export type FunnelContentPart =
  | FunnelTextPart
  | FunnelFilePartByOpenAiId
  | FunnelFilePartInline
  | FunnelImageUrlPart;

export interface FunnelMessage {
  role: 'user' | 'assistant';
  content: string | FunnelContentPart[];
}

export interface FunnelOptions {
  /** Optional. When true, ask the provider to emit valid JSON. If
   *  `jsonSchema` is also supplied, the funnel will request strict
   *  schema-bound JSON where the provider supports it (OpenAI
   *  `response_format: json_schema`, Gemini `responseSchema`). */
  jsonMode?: boolean;
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  temperature?: number;
}

interface FunnelResult {
  content: string;
  promptTokens: number;
  completionTokens: number;
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
    @Inject(forwardRef(() => RagService))
    private readonly ragService: RagService,
    private readonly eventEmitter: EventEmitter2,
  ) {
    // Derive a 32-byte key from JWT_SECRET for encrypting stored API keys.
    // getOrThrow (not the previous `.get(..., 'dev-secret-change-in-production')`)
    // is deliberate: that fallback is a PUBLIC string committed in
    // docker-compose.yml. If JWT_SECRET were ever missing at runtime, every
    // stored teacher API key would have been silently encrypted with a key
    // anyone can derive — fail loudly instead.
    const secret = this.config.getOrThrow<string>('JWT_SECRET');
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
    const parts = data.split(':');
    const iv = Buffer.from(parts[0]!, 'hex');
    const authTag = Buffer.from(parts[1]!, 'hex');
    const encrypted = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv(ENCRYPTION_ALGO, this.encryptionKey, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  async saveApiKey(
    userId: string,
    provider: string,
    apiKey: string,
    model?: string,
    embeddingModel?: string,
  ) {
    // Stage 2 of the LLM upgrade: validate every persisted model id against
    // the registry, not just trust whatever string the client posted. A
    // teacher can no longer save an unknown model, a model that belongs to
    // a different provider, or a fully-retired model.
    const providerTyped = this.assertSelectableProvider(provider);
    const resolvedModel = this.assertChatModelAllowed(providerTyped, model);
    const resolvedEmbeddingModel = this.assertEmbeddingModelAllowed(providerTyped, embeddingModel);

    // Read the existing embedding-model pin before we write so we can
    // mark the teacher's owned source documents `needsReembed = true`
    // when the value actually changes. Stage 3 owns the worker that
    // consumes this marker — here we only set up the contract.
    const previous = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { llmEmbeddingModel: true },
    });

    // Bedrock uses one server-wide credential (AWS_BEARER_TOKEN), not a
    // per-teacher key — nothing to encrypt/store beyond the provider +
    // model selection itself.
    const encrypted = providerTyped === 'bedrock' ? null : this.encrypt(apiKey);

    await this.prisma.user.update({
      where: { id: userId },
      data: {
        llmProvider: providerTyped,
        encryptedApiKey: encrypted,
        llmModel: resolvedModel,
        llmEmbeddingModel: resolvedEmbeddingModel,
      },
    });

    await this.markCorporaForReembedIfChanged(
      userId,
      previous?.llmEmbeddingModel ?? null,
      resolvedEmbeddingModel,
    );

    return {
      saved: true,
      provider: providerTyped,
      model: resolvedModel,
      embeddingModel: resolvedEmbeddingModel,
    };
  }

  async removeApiKey(userId: string) {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        llmProvider: null,
        encryptedApiKey: null,
        llmModel: null,
        llmEmbeddingModel: null,
      },
    });
    return { removed: true };
  }

  async getUserLlmSettings(userId: string): Promise<UserLlmSettings> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        llmProvider: true,
        llmModel: true,
        llmEmbeddingModel: true,
        encryptedApiKey: true,
        cohereApiKey: true,
      },
    });
    // Bedrock has no per-teacher encryptedApiKey row — "configured" means
    // the server-wide AWS_BEARER_TOKEN is actually set, not that this
    // teacher personally saved a key.
    const hasKey =
      user?.llmProvider === 'bedrock'
        ? !!this.config.get<string>('AWS_BEARER_TOKEN')
        : !!user?.encryptedApiKey;

    return {
      provider: user?.llmProvider || null,
      model: user?.llmModel || null,
      embeddingModel: user?.llmEmbeddingModel || null,
      hasKey,
      hasCohereKey: !!user?.cohereApiKey,
    };
  }

  // ─── Cohere API Key Management (Stage 04) ────────────────
  //
  // Cohere is a separate vendor from the chat LLM (OpenAI/Gemini) —
  // we keep its key on a separate `User.cohereApiKey` column so a
  // teacher can opt into reranking without touching their chat
  // credentials. Encrypted with the SAME AES-256-GCM helper as
  // `encryptedApiKey` (the encryption key is derived from
  // `JWT_SECRET`; reusing it means there's one secret to rotate
  // rather than two).

  async saveCohereApiKey(userId: string, apiKey: string): Promise<{ saved: true }> {
    if (!apiKey?.trim()) {
      throw new BadRequestException('Cohere API key is required');
    }
    const encrypted = this.encrypt(apiKey.trim());
    await this.prisma.user.update({
      where: { id: userId },
      data: { cohereApiKey: encrypted },
    });
    return { saved: true };
  }

  async removeCohereApiKey(userId: string): Promise<{ removed: true }> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { cohereApiKey: null },
    });
    return { removed: true };
  }

  /**
   * Resolve the teacher's Cohere key for the cross-encoder reranker.
   * Returns `null` when no key is configured or decryption fails —
   * the reranker MUST handle null by falling back to the noop path.
   * NEVER throws (triple-defensive contract on the rerank surface).
   */
  async getCohereApiKey(userId: string): Promise<string | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: userId },
        select: { cohereApiKey: true },
      });
      if (!user?.cohereApiKey) return null;
      return this.decrypt(user.cohereApiKey);
    } catch (err) {
      this.logger.warn(
        `Failed to decrypt Cohere key for user ${userId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  private async getUserApiKey(
    userId: string,
  ): Promise<{ apiKey: string; model: string; provider: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { llmProvider: true, llmModel: true, encryptedApiKey: true },
    });

    // Bedrock uses one server-wide credential (AWS_BEARER_TOKEN), not a
    // per-teacher encrypted key — resolve it separately, before the
    // `encryptedApiKey` gate below (which would otherwise always be null
    // for a bedrock-selected teacher and short-circuit to no-key/template
    // mode).
    if (user?.llmProvider === 'bedrock') {
      const bearerToken = this.config.get<string>('AWS_BEARER_TOKEN');
      if (!bearerToken) {
        this.logger.error(
          `User ${userId} selected Bedrock but AWS_BEARER_TOKEN is not configured on the server`,
        );
        return null;
      }
      const resolvedModel = this.resolveChatModelWithGuard(
        'bedrock',
        user.llmModel ?? null,
        userId,
      );
      return { apiKey: bearerToken, model: resolvedModel, provider: 'bedrock' };
    }

    if (!user?.encryptedApiKey) return null;
    try {
      const apiKey = this.decrypt(user.encryptedApiKey);
      const provider = (user.llmProvider === 'gemini' ? 'gemini' : 'openai') as LlmProvider;
      const storedModel = user.llmModel ?? null;
      const resolvedModel = this.resolveChatModelWithGuard(provider, storedModel, userId);
      return { apiKey, model: resolvedModel, provider };
    } catch {
      this.logger.error(`Failed to decrypt API key for user ${userId}`);
      return null;
    }
  }

  // ─── Read-time guard + validation helpers ─────────────────
  //
  // Stage 2 (`LLM_20260602/stage2_*`) introduces two safety layers around
  // the model the funnel will actually call:
  //
  //   1. `resolveChatModelWithGuard()` runs on every funnel-routed call.
  //      If the persisted `User.llmModel` no longer exists in the registry
  //      or has been hard-retired (e.g. the dead `gemini-2.0-flash`), we
  //      substitute the provider's recommended default and log a `warn` so
  //      the live system stops 404-ing immediately, before the data
  //      migration script runs.
  //
  //   2. `assertChatModelAllowed` / `assertEmbeddingModelAllowed` validate
  //      a teacher's *intended* save. Mismatched provider, unknown id, and
  //      retired models are all rejected with a 400 — the registry is the
  //      single source of truth.

  private resolveChatModelWithGuard(
    provider: LlmProvider,
    storedModel: string | null,
    userId: string,
  ): string {
    if (!storedModel) {
      return defaultChatModel(provider).id;
    }
    const spec = getChatModel(storedModel);
    if (spec && spec.provider === provider && isSelectable(spec.id)) {
      return storedModel;
    }
    const fallback = defaultChatModel(provider).id;
    const reason = !spec
      ? 'not in registry'
      : spec.provider !== provider
        ? `provider mismatch (registry says ${spec.provider}, user provider is ${provider})`
        : 'retired';
    // eslint-disable-next-line no-console
    console.warn(
      `[LlmService] Read-time guard: user ${userId} model "${storedModel}" is ${reason}; substituting "${fallback}".`,
    );
    return fallback;
  }

  private assertSelectableProvider(provider: string): LlmProvider {
    if (provider !== 'openai' && provider !== 'gemini' && provider !== 'bedrock') {
      throw new BadRequestException(
        `Unsupported LLM provider "${provider}". Expected one of: openai, gemini, bedrock.`,
      );
    }
    return provider;
  }

  private assertChatModelAllowed(provider: LlmProvider, modelId?: string | null): string {
    if (!modelId) {
      // No model supplied → use registry default for the provider.
      return defaultChatModel(provider).id;
    }
    const spec = getChatModel(modelId);
    if (!spec) {
      throw new BadRequestException(
        `Unknown chat model "${modelId}". Pick a model from /llm/models?provider=${provider}.`,
      );
    }
    if (spec.provider !== provider) {
      throw new BadRequestException(
        `Chat model "${modelId}" belongs to provider "${spec.provider}", not "${provider}".`,
      );
    }
    if (!isSelectable(spec.id)) {
      throw new BadRequestException(
        `Chat model "${modelId}" is retired and can no longer be selected. Try ${defaultChatModel(provider).id} instead.`,
      );
    }
    return spec.id;
  }

  private assertEmbeddingModelAllowed(provider: LlmProvider, modelId?: string | null): string {
    if (!modelId) {
      return defaultEmbeddingModel(provider).id;
    }
    const spec = getEmbeddingModel(modelId);
    if (!spec) {
      throw new BadRequestException(
        `Unknown embedding model "${modelId}". Pick a model from /llm/models?provider=${provider}.`,
      );
    }
    if (spec.provider !== provider) {
      throw new BadRequestException(
        `Embedding model "${modelId}" belongs to provider "${spec.provider}", not "${provider}".`,
      );
    }
    if (!isSelectable(spec.id)) {
      throw new BadRequestException(
        `Embedding model "${modelId}" is retired and can no longer be selected. Try ${defaultEmbeddingModel(provider).id} instead.`,
      );
    }
    return spec.id;
  }

  /**
   * When a teacher actively changes their embedding model, flag every
   * corpus they own that was indexed under the OLD model so Stage 3's
   * worker can re-embed. We deliberately do NOT touch corpora when:
   *   - the teacher's previous value was null (legacy default — leave it
   *     pinned at `text-embedding-ada-002` as the migration backfilled),
   *   - the new value equals the previous value (no-op save), or
   *   - the corpus is already pinned to the new value.
   *
   * Stage 2 owns the marker only. Stage 3 owns the actual re-embed flow.
   */
  private async markCorporaForReembedIfChanged(
    teacherId: string,
    previous: string | null,
    next: string,
  ): Promise<void> {
    if (!previous) return; // first-time set: no existing corpora to disturb
    if (previous === next) return;

    const [teacherDocs, studentDocs] = await Promise.all([
      this.prisma.sourceDocument.updateMany({
        where: {
          uploadedById: teacherId,
          embeddingModel: previous,
          needsReembed: false,
        },
        data: { needsReembed: true },
      }),
      this.prisma.studentSourceDocument.updateMany({
        where: {
          course: { teacherId },
          embeddingModel: previous,
          needsReembed: false,
        },
        data: { needsReembed: true },
      }),
    ]);

    this.logger.log(
      `Embedding model changed for teacher ${teacherId} (${previous} → ${next}); marked ${teacherDocs.count} teacher docs + ${studentDocs.count} student docs needsReembed=true.`,
    );

    // Stage 3: kick off the re-embed worker for the teacher's student
    // corpora. Teacher corpora are keyword-only (rag.service.ts:391
    // confirms no embeddings yet) so we only need to re-embed student
    // docs here. Fire-and-forget; the worker tolerates re-runs.
    if (studentDocs.count > 0) {
      this.eventEmitter.emit('student-document.reembed-teacher', { teacherId });
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
    const result = await this.callLlm(
      {
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      credentials,
    );

    const citations = this.extractCitations(result.content, input.chunks);

    let strictSourceValid = true;
    let notEnoughInfo = false;

    if (input.strictSource) {
      const validation = this.ragService.validateCitations(result.content, citations, input.chunks);
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

    // Log LLM usage for cost tracking
    await this.logLlmUsage({
      userId: input.userId,
      courseId: input.courseId,
      provider: credentials?.provider || 'template',
      model: modelUsed,
      inputTokens: result.promptTokens,
      outputTokens: result.completionTokens,
      feature: 'query_rag',
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
    const result = await this.callLlm(
      {
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
      },
      credentials,
    );

    const citations = this.extractCitations(result.content, input.chunks);

    let strictSourceValid = true;
    let notEnoughInfo = false;

    if (input.strictSource) {
      const validation = this.ragService.validateCitations(result.content, citations, input.chunks);
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
        citations: citations as unknown as import('@prisma/client').Prisma.InputJsonValue,
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

    // Log LLM usage for cost tracking
    await this.logLlmUsage({
      userId: input.userId,
      courseId: input.courseId,
      provider: credentials?.provider || 'template',
      model: modelUsed,
      inputTokens: result.promptTokens,
      outputTokens: result.completionTokens,
      feature: 'content_generation',
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

  async rejectDraft(draftId: string, _userId: string) {
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

  // ─── Public Helpers ──────────────────────────────────────

  async hasApiKey(userId: string): Promise<boolean> {
    const credentials = await this.getUserApiKey(userId);
    return credentials !== null;
  }

  async callLlmForUser(
    userId: string,
    systemPrompt: string,
    userPrompt: string,
    usageContext?: {
      feature: string;
      courseId?: string;
      triggeredByUserId?: string;
      modality?: 'text' | 'image';
    },
    options?: FunnelOptions,
  ): Promise<{
    content: string;
    promptTokens: number;
    completionTokens: number;
    /** Model identifier that produced this completion (null when no credentials → template path). */
    model: string | null;
    /** Provider name (openai | anthropic | gemini | template). */
    provider: string | null;
  }> {
    return this.callLlmStructured(
      userId,
      {
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        ...options,
      },
      usageContext,
    );
  }

  /**
   * Registry-driven structured entry point for chat. Accepts a normalized
   * request and dispatches to the resolved provider with capability-flag-
   * aware request building. All Stage 3 bypass refactors call this.
   *
   * If the teacher has no API key configured, the funnel falls back to the
   * built-in template generator (existing behavior). Provider errors
   * propagate to the caller so it can decide whether to fall back further.
   */
  async callLlmStructured(
    userId: string,
    request: {
      systemPrompt: string;
      messages: FunnelMessage[];
      jsonMode?: boolean;
      jsonSchema?: Record<string, unknown>;
      maxTokens?: number;
      temperature?: number;
    },
    usageContext?: {
      feature: string;
      courseId?: string;
      triggeredByUserId?: string;
      modality?: 'text' | 'image';
    },
  ): Promise<{
    content: string;
    promptTokens: number;
    completionTokens: number;
    model: string | null;
    provider: string | null;
  }> {
    const credentials = await this.getUserApiKey(userId);
    const result = await this.callLlm(request, credentials);

    if (usageContext) {
      await this.logLlmUsage({
        userId: usageContext.triggeredByUserId || userId,
        courseId: usageContext.courseId,
        provider: credentials?.provider || 'template',
        model: credentials?.model || 'template',
        inputTokens: result.promptTokens,
        outputTokens: result.completionTokens,
        feature: usageContext.feature,
        modality: usageContext.modality,
      });
    }

    return {
      ...result,
      model: credentials?.model ?? null,
      provider: credentials?.provider ?? null,
    };
  }

  /**
   * Exposes the resolved chat-model spec for the teacher so call sites can
   * branch on capability flags (e.g. `supportsOpenAiFilesApi`) BEFORE
   * issuing the funnel call. Returns null when the teacher has no key
   * configured.
   */
  async getResolvedChatModelForUser(
    userId: string,
  ): Promise<{ spec: ChatModelSpec; provider: LlmProvider } | null> {
    const credentials = await this.getUserApiKey(userId);
    if (!credentials) return null;
    const spec = getChatModel(credentials.model);
    if (!spec) return null;
    return { spec, provider: credentials.provider as LlmProvider };
  }

  /**
   * Upload a PDF (or any binary) to OpenAI's Files API on behalf of a user.
   * Returns the file_id so callers can reference it in subsequent chat
   * completions (avoids re-uploading the same PDF on every generation).
   * Returns null when the user has no OpenAI key configured, the provider
   * is not OpenAI, or the upload fails — callers should fall back to inline
   * base64 in that case.
   */
  async uploadFileToOpenAi(
    userId: string,
    filename: string,
    buffer: Buffer,
    mimeType: string = 'application/pdf',
  ): Promise<string | null> {
    const credentials = await this.getUserApiKey(userId);
    if (!credentials) {
      this.logger.warn(`uploadFileToOpenAi: user ${userId} has no API key configured`);
      return null;
    }
    if (credentials.provider !== 'openai') {
      this.logger.log(
        `uploadFileToOpenAi: user ${userId} provider is ${credentials.provider}, skipping OpenAI Files upload`,
      );
      return null;
    }
    try {
      const form = new FormData();
      const blob = new Blob([new Uint8Array(buffer)], { type: mimeType });
      form.append('file', blob, filename);
      form.append('purpose', 'user_data');

      const response = await fetch('https://api.openai.com/v1/files', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${credentials.apiKey}`,
        },
        body: form,
      });
      if (!response.ok) {
        const errText = await response.text();
        this.logger.error(
          `OpenAI Files upload failed (${response.status}) for "${filename}": ${errText}`,
        );
        return null;
      }
      const data = (await response.json()) as { id?: string };
      if (!data.id) {
        this.logger.error(`OpenAI Files upload returned no id for "${filename}"`);
        return null;
      }
      this.logger.log(`Uploaded "${filename}" to OpenAI Files API → ${data.id}`);
      return data.id;
    } catch (err) {
      this.logger.error(`uploadFileToOpenAi threw for "${filename}": ${(err as Error).message}`);
      return null;
    }
  }

  /**
   * Best-effort delete of an OpenAI-stored file. Called when the source
   * document is removed locally so we don't leave orphan files on OpenAI.
   * Never throws — failures are logged.
   */
  async deleteFileFromOpenAi(userId: string, fileId: string): Promise<void> {
    const credentials = await this.getUserApiKey(userId);
    if (!credentials || credentials.provider !== 'openai') return;
    try {
      const response = await fetch(`https://api.openai.com/v1/files/${fileId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${credentials.apiKey}` },
      });
      if (!response.ok) {
        const errText = await response.text();
        this.logger.warn(
          `OpenAI Files delete failed (${response.status}) for ${fileId}: ${errText}`,
        );
      }
    } catch (err) {
      this.logger.warn(`deleteFileFromOpenAi threw for ${fileId}: ${(err as Error).message}`);
    }
  }

  async logLlmUsage(params: {
    userId: string;
    courseId?: string;
    provider: string;
    model: string;
    inputTokens: number;
    outputTokens: number;
    feature: string;
    modality?: 'text' | 'image';
    metadata?: Record<string, unknown>;
  }): Promise<void> {
    try {
      const cost = await calculateCost(this.prisma, {
        inputTokens: params.inputTokens,
        outputTokens: params.outputTokens,
        model: params.model,
        provider: params.provider,
      });

      await this.prisma.llmUsageLog.create({
        data: {
          userId: params.userId,
          courseId: params.courseId || null,
          provider: params.provider,
          model: params.model,
          inputTokens: params.inputTokens,
          outputTokens: params.outputTokens,
          totalTokens: params.inputTokens + params.outputTokens,
          inputCost: cost.inputCost,
          outputCost: cost.outputCost,
          totalCost: cost.totalCost,
          feature: params.feature,
          modality: params.modality ?? 'text',
          metadata:
            (params.metadata as import('@prisma/client').Prisma.InputJsonValue) ?? undefined,
        },
      });
    } catch (err) {
      this.logger.error('Failed to log LLM usage', err);
    }
  }

  // ─── Private Helpers ───────────────────────────────────

  private async callLlm(
    request: {
      systemPrompt: string;
      messages: FunnelMessage[];
      jsonMode?: boolean;
      jsonSchema?: Record<string, unknown>;
      maxTokens?: number;
      temperature?: number;
    },
    credentials: { apiKey: string; model: string; provider: string } | null,
  ): Promise<FunnelResult> {
    // No key → template fallback. The template generator reads simple
    // flat strings, so flatten the structured input for legacy parsing.
    if (!credentials) {
      const userText = this.flattenMessagesToText(request.messages);
      return this.generateWithoutApi(request.systemPrompt, userText);
    }

    const provider = credentials.provider as LlmProvider;
    const spec = getChatModel(credentials.model);
    // Defensive: read-time guard in getUserApiKey should have already
    // substituted an in-registry model, but if a brand-new model slips
    // through we fall back to the provider's default spec to drive call
    // shape. This keeps the funnel alive instead of crashing.
    const effectiveSpec = spec ?? defaultChatModel(provider);

    try {
      if (provider === 'gemini') {
        return await this.callGeminiApi(
          request,
          credentials.apiKey,
          credentials.model,
          effectiveSpec,
        );
      }
      if (provider === 'bedrock') {
        return await this.callBedrockApi(
          request,
          credentials.apiKey,
          credentials.model,
          effectiveSpec,
        );
      }
      return await this.callOpenAiApi(
        request,
        credentials.apiKey,
        credentials.model,
        effectiveSpec,
      );
    } catch (error) {
      this.logger.error(`Provider call failed (${provider}/${credentials.model})`, error);
      // For JSON requests we MUST surface — silent template fallback
      // here is what causes intervention parsers to think Gemini failed
      // when it just couldn't be parsed. Let the caller decide.
      if (request.jsonMode || request.jsonSchema) throw error;
      // Free-text path: legacy behavior, degrade to template.
      const userText = this.flattenMessagesToText(request.messages);
      return this.generateWithoutApi(request.systemPrompt, userText);
    }
  }

  /**
   * Flatten the structured-message input into a single string for the
   * template fallback (no API key path). Strips file parts because the
   * template generator has no notion of multimodal inputs.
   */
  private flattenMessagesToText(messages: FunnelMessage[]): string {
    return messages
      .map((m) => {
        if (typeof m.content === 'string') return m.content;
        return m.content
          .filter((p): p is FunnelTextPart => p.type === 'text')
          .map((p) => p.text)
          .join('\n');
      })
      .join('\n\n');
  }

  // ─── OpenAI: registry-driven request shape ──────────────

  private async callOpenAiApi(
    request: {
      systemPrompt: string;
      messages: FunnelMessage[];
      jsonMode?: boolean;
      jsonSchema?: Record<string, unknown>;
      maxTokens?: number;
      temperature?: number;
    },
    apiKey: string,
    model: string,
    spec: ChatModelSpec,
  ): Promise<FunnelResult> {
    const body: Record<string, unknown> = { model };

    // Token cap: GPT-5.x reasoning uses max_completion_tokens; older
    // OpenAI uses max_tokens.
    const tokenLimit = request.maxTokens ?? 4096;
    body[spec.maxTokensParam] = tokenLimit;

    // Only set temperature/top_p when the model accepts a custom one.
    if (spec.supportsTemperature && request.temperature !== undefined) {
      body.temperature = request.temperature;
    }

    // JSON mode: prefer schema-bound when both are available.
    if (spec.supportsJsonMode && (request.jsonMode || request.jsonSchema)) {
      if (request.jsonSchema) {
        body.response_format = {
          type: 'json_schema',
          json_schema: {
            name: 'response',
            schema: request.jsonSchema,
            strict: false,
          },
        };
      } else {
        body.response_format = { type: 'json_object' };
      }
    }

    // System prompt → first message with role=system. Pass-through
    // content parts so multimodal payloads (file_id / inline) work.
    const messages: Array<{ role: string; content: unknown }> = [
      { role: 'system', content: request.systemPrompt },
    ];
    for (const m of request.messages) {
      messages.push({ role: m.role, content: m.content });
    }
    body.messages = messages;

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`OpenAI API error: ${response.status} ${errorText}`);
      throw new Error(`OpenAI API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: data.choices?.[0]?.message?.content || '',
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
    };
  }

  // ─── AWS Bedrock: Converse API (model-agnostic) ──────────
  //
  // Uses Bedrock's Converse API rather than each model's native
  // InvokeModel body shape — it's the one request/response envelope AWS
  // guarantees works the same across every hosted model family, which
  // matters here since these are OpenAI models hosted ON Bedrock, not
  // reachable via api.openai.com. Auth is the newer Bedrock API-key
  // (bearer token) scheme — no SigV4 request signing needed, same
  // "Authorization: Bearer <token>" shape as callOpenAiApi/callGeminiApi
  // above. Region is hardcoded (not env-configurable) — every request
  // MUST go through ap-southeast-1 per the account's Bedrock access
  // grant, so there's no knob to accidentally point it elsewhere.
  private static readonly BEDROCK_REGION = 'ap-southeast-1';

  private async callBedrockApi(
    request: {
      systemPrompt: string;
      messages: FunnelMessage[];
      jsonMode?: boolean;
      jsonSchema?: Record<string, unknown>;
      maxTokens?: number;
      temperature?: number;
    },
    apiKey: string,
    model: string,
    spec: ChatModelSpec,
  ): Promise<FunnelResult> {
    const url = `https://bedrock-runtime.${LlmService.BEDROCK_REGION}.amazonaws.com/model/${encodeURIComponent(model)}/converse`;

    // No schema-bound response_format on Converse for this model family —
    // JSON mode is enforced by prompt instruction only, same fallback
    // technique already used for the no-API-key template path.
    let systemText = request.systemPrompt;
    if (request.jsonMode || request.jsonSchema) {
      systemText += '\n\nRespond with ONLY valid JSON, no prose, no markdown code fences.';
      if (request.jsonSchema) {
        systemText += ` The JSON must conform to this schema: ${JSON.stringify(request.jsonSchema)}`;
      }
    }

    // Converse understands text and image content parts natively (used
    // by VLM slide description — see vlm.service.ts, which sends
    // `image_url` parts through this same shared funnel). OpenAI
    // Files-API file-id refs have no Bedrock equivalent and are
    // dropped (logged) rather than sent as something the API will
    // reject.
    const messages = request.messages.map((m) => {
      if (typeof m.content === 'string') {
        return { role: m.role, content: [{ text: m.content }] };
      }
      const content: Array<
        { text: string } | { image: { format: string; source: { bytes: string } } }
      > = [];
      for (const p of m.content) {
        if (p.type === 'text') {
          content.push({ text: p.text });
        } else if (p.type === 'image_url') {
          const parsed = parseDataUrl(p.image_url.url);
          if (!parsed) continue;
          const format = bedrockImageFormat(parsed.mimeType);
          if (!format) {
            this.logger.warn(`callBedrockApi: unsupported image mime type "${parsed.mimeType}"`);
            continue;
          }
          content.push({ image: { format, source: { bytes: parsed.base64 } } });
        } else {
          this.logger.warn(`callBedrockApi: dropping unsupported content part "${p.type}"`);
        }
      }
      return { role: m.role, content };
    });

    const inferenceConfig: Record<string, unknown> = {
      maxTokens: request.maxTokens ?? 4096,
    };
    if (spec.supportsTemperature && request.temperature !== undefined) {
      inferenceConfig.temperature = request.temperature;
    }

    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        system: [{ text: systemText }],
        messages,
        inferenceConfig,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Bedrock API error: ${response.status} ${errorText}`);
      throw new Error(`Bedrock API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      output?: { message?: { content?: Array<{ text?: string }> } };
      usage?: { inputTokens?: number; outputTokens?: number };
    };

    const content = (data.output?.message?.content ?? []).map((c) => c.text ?? '').join('');

    return {
      content,
      promptTokens: data.usage?.inputTokens || 0,
      completionTokens: data.usage?.outputTokens || 0,
    };
  }

  // ─── Gemini: registry-driven request shape ──────────────

  private async callGeminiApi(
    request: {
      systemPrompt: string;
      messages: FunnelMessage[];
      jsonMode?: boolean;
      jsonSchema?: Record<string, unknown>;
      maxTokens?: number;
      temperature?: number;
    },
    apiKey: string,
    model: string,
    spec: ChatModelSpec,
  ): Promise<FunnelResult> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`;

    const generationConfig: Record<string, unknown> = {
      maxOutputTokens: request.maxTokens ?? 4096,
    };
    if (spec.supportsTemperature && request.temperature !== undefined) {
      generationConfig.temperature = request.temperature;
    }

    // Thinking: drive from registry. 3.x → thinking_level enum.
    //          2.x → thinking_budget integer.
    //          'none' / undefined → omit (model default).
    if (spec.geminiThinkingParam === 'thinking_level') {
      generationConfig.thinkingConfig = { thinkingLevel: 'medium' };
    } else if (spec.geminiThinkingParam === 'thinking_budget') {
      // Conservative default that still allows useful thought on 2.x.
      generationConfig.thinkingConfig = { thinkingBudget: 1024 };
    }

    // JSON mode: responseMimeType (+ optional responseSchema).
    if (spec.supportsJsonMode && (request.jsonMode || request.jsonSchema)) {
      generationConfig.responseMimeType = 'application/json';
      if (request.jsonSchema) {
        generationConfig.responseSchema = request.jsonSchema;
      }
    }

    // Translate FunnelMessage[] → Gemini contents.
    const contents = request.messages.map((m) => {
      const role = m.role === 'assistant' ? 'model' : 'user';
      const parts =
        typeof m.content === 'string'
          ? [{ text: m.content } as GeminiPart]
          : m.content
              .map((p): GeminiPart | null => {
                if (p.type === 'text') {
                  return { text: p.text };
                }
                if (p.type === 'image_url') {
                  // Stage 05 — translate OpenAI-style `image_url` to
                  // Gemini `inlineData`. We parse the data URL into
                  // (mimeType, base64) so Gemini gets the bytes it
                  // expects. Remote URLs are not supported (see
                  // FunnelImageUrlPart comment).
                  const parsed = parseDataUrl(p.image_url.url);
                  if (!parsed) return null;
                  return {
                    inlineData: {
                      mimeType: parsed.mimeType,
                      data: parsed.base64,
                    },
                  };
                }
                // OpenAI file-id refs are meaningless under Gemini. The
                // multimodal call sites in Stage 3.5 substitute chunked
                // text BEFORE reaching the funnel; if anything still
                // sneaks through, drop it rather than 400.
                return null;
              })
              .filter((p): p is GeminiPart => p !== null);
      return { role, parts };
    });

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: request.systemPrompt }] },
        contents,
        generationConfig,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Gemini API error: ${response.status} ${errorText}`);
      throw new Error(`Gemini API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
      usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
    };

    // Concat ALL text parts (Gemini sometimes returns multiple).
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const content = parts.map((p) => p.text ?? '').join('');

    return {
      content,
      promptTokens: data.usageMetadata?.promptTokenCount || 0,
      completionTokens: data.usageMetadata?.candidatesTokenCount || 0,
    };
  }

  private async generateWithoutApi(
    systemPrompt: string,
    userPrompt: string,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    const sourceMatch = userPrompt.match(/Source \d+[\s\S]*?(?=---|$)/g);
    const questionMatch = userPrompt.match(/Question:\s*(.*)/);
    const generateMatch = userPrompt.match(/Generate course content for:\s*"([^"]+)"/);
    const instructionsMatch = userPrompt.match(/Teacher instructions:\s*([\s\S]*?)$/);

    let content = '';

    if (generateMatch) {
      const title = generateMatch[1] || '';
      const instructions = instructionsMatch?.[1]?.trim() || '';
      content = this.buildTemplateContent(title, instructions, sourceMatch || []);
    } else if (questionMatch) {
      const question = questionMatch[1] || '';
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

  private buildTemplateContent(title: string, instructions: string, sources: string[]): string {
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
      citedNumbers.add(parseInt(match[1]!, 10));
    }

    return Array.from(citedNumbers)
      .filter((n) => n >= 1 && n <= chunks.length)
      .map((n) => {
        const chunk = chunks[n - 1]!;
        return {
          chunkId: chunk.id,
          documentTitle: chunk.documentTitle,
          pageNumber: chunk.pageNumber,
          quote: chunk.content.slice(0, 100),
        };
      });
  }

  private noSourcesResponse(_input: GenerateRagAnswerInput): LlmResponse {
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
    inputPayload?: import('@prisma/client').Prisma.InputJsonValue;
    outputPayload?: import('@prisma/client').Prisma.InputJsonValue;
    errorMessage?: string;
  }): Promise<void> {
    try {
      await this.prisma.llmAuditLog.create({ data });
    } catch (err) {
      this.logger.error('Failed to create audit log', err);
    }
  }
}

// ─── Stage 05 — Gemini multimodal helper types + utilities ──

/** Gemini `contents[i].parts[j]` is either text or `inlineData`. */
type GeminiPart = { text: string } | { inlineData: { mimeType: string; data: string } };

/**
 * Parse a `data:mime/type;base64,...` URL into its mime type and
 * base64 payload. Returns null when the input isn't a base64 data
 * URL — callers drop the part rather than crashing the request.
 */
function parseDataUrl(url: string): { mimeType: string; base64: string } | null {
  const match = url.match(/^data:([^;]+);base64,(.*)$/);
  if (!match) return null;
  return { mimeType: match[1]!, base64: match[2]! };
}

// ─── Bedrock: Converse image content-block format ────────────

/** Bedrock Converse's `image.format` enum only accepts these four
 *  values. Returns null for anything else so the caller can drop the
 *  part rather than sending a value the API will reject. */
function bedrockImageFormat(mimeType: string): 'png' | 'jpeg' | 'gif' | 'webp' | null {
  switch (mimeType) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
    case 'image/jpg':
      return 'jpeg';
    case 'image/gif':
      return 'gif';
    case 'image/webp':
      return 'webp';
    default:
      return null;
  }
}
