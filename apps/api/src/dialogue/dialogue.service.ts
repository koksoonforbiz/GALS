import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import { LlmService } from '../rag/llm.service';
import { RagService } from '../rag/rag.service';
import { ActivityLogService, ActivityAction } from '../activity-log';
import { TextMiningService } from '../text-mining';
import type { DialogueCourseSettings } from '@ats/shared';
import { DialogueCourseSettingsSchema } from '@ats/shared';
import type { CreateSessionDto, SendMessageDto } from './dto';
import { StudentRagRetrievalService } from '../student-rag/student-rag-retrieval.service';
import type { RetrievedChunk } from '../student-rag/student-rag-retrieval.service';
import { EmbeddingService } from '../student-rag/embedding.service';
import { Prisma } from '@prisma/client';
// Stage 06 — shared grounded-generation contract.
import { buildGroundedMessages } from '../rag/shared/grounded-prompt';
import { GroundedEvidenceService } from '../rag/shared/grounded-evidence.service';
import { loadImageChunkMetadata } from '../rag/shared/grounded-evidence.helpers';
import { FaithfulnessCheckService, buildFaithfulnessRetryAddendum } from '../rag/shared/faithfulness-check.service';
import { faithfulnessCheckEnabled } from '../rag/shared/multimodal-generation.flags';

// Stage 02 feature flag. `RAG_USE_SHARED_RETRIEVER=false` falls back to
// the legacy local keyword scorer (`retrieveStudentChunksKeywordLegacy`)
// for instant rollback. Default ON (true).
function sharedRetrieverEnabled(): boolean {
  const v = (process.env.RAG_USE_SHARED_RETRIEVER ?? 'true').toLowerCase();
  return v !== 'false' && v !== '0' && v !== 'off';
}

@Injectable()
export class DialogueService {
  private readonly logger = new Logger(DialogueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly ragService: RagService,
    private readonly activityLogService: ActivityLogService,
    @Inject(forwardRef(() => TextMiningService))
    private readonly textMining: TextMiningService,
    private readonly studentRagRetrieval: StudentRagRetrievalService,
    private readonly embeddingService: EmbeddingService,
    // Stage 06 — multimodal grounding + optional faithfulness check.
    // Both services come through RagModule exports (same module that
    // provides LlmService) so no new imports are needed.
    private readonly groundedEvidence: GroundedEvidenceService,
    private readonly faithfulnessCheck: FaithfulnessCheckService,
  ) {}

  // ─── Session CRUD ─────────────────────────────────────────

  async createSession(
    studentId: string,
    courseId: string,
    dto: CreateSessionDto,
    sessionId?: string,
  ) {
    const enrollment = await this.verifyEnrollment(studentId, courseId);

    const dialogueSession = await this.prisma.dialogueSession.create({
      data: {
        enrollmentId: enrollment.id,
        studentId,
        courseId,
        title: dto.title || 'New Session',
        activeSourceIds: dto.activeSourceIds || [],
      },
      include: { _count: { select: { messages: true, studioOutputs: true } } },
    });

    if (sessionId) {
      void this.activityLogService.record({
        sessionId,
        userId: studentId,
        action: ActivityAction.DIALOGUE_SESSION_STARTED,
        dialogueSessionId: dialogueSession.id,
        courseId,
        metadata: { summary: 'Dialogue session started' },
      });
    }

    return dialogueSession;
  }

  async listSessions(studentId: string, courseId: string) {
    await this.verifyEnrollment(studentId, courseId);

    return this.prisma.dialogueSession.findMany({
      where: { studentId, courseId },
      include: { _count: { select: { messages: true, studioOutputs: true } } },
      orderBy: { updatedAt: 'desc' },
    });
  }

  async getSession(sessionId: string, studentId: string) {
    const session = await this.prisma.dialogueSession.findUnique({
      where: { id: sessionId },
      include: {
        _count: { select: { messages: true, studioOutputs: true } },
      },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.studentId !== studentId) {
      throw new ForbiddenException('Not your session');
    }
    return session;
  }

  async updateSession(
    sessionId: string,
    studentId: string,
    dto: { title?: string; activeSourceIds?: string[] },
  ) {
    await this.verifySessionOwnership(sessionId, studentId);

    const data: Record<string, unknown> = {};
    if (dto.title !== undefined) data.title = dto.title;
    if (dto.activeSourceIds !== undefined) data.activeSourceIds = dto.activeSourceIds;

    return this.prisma.dialogueSession.update({
      where: { id: sessionId },
      data,
      include: { _count: { select: { messages: true, studioOutputs: true } } },
    });
  }

  async deleteSession(sessionId: string, studentId: string) {
    await this.verifySessionOwnership(sessionId, studentId);
    await this.prisma.dialogueSession.delete({ where: { id: sessionId } });
    return { deleted: true };
  }

  // ─── Chat (send message + RAG retrieval) ──────────────────

  async sendMessage(
    sessionId: string,
    studentId: string,
    dto: SendMessageDto,
    activitySessionId?: string,
  ) {
    const session = await this.verifySessionOwnership(sessionId, studentId);
    const course = await this.prisma.course.findUnique({
      where: { id: session.courseId },
    });
    if (!course) throw new NotFoundException('Course not found');

    const dblSettings = this.parseDblSettings(course.dblSettings);

    // Determine active sources: per-message override > session default
    const activeSourceIds =
      dto.activeSourceIds && dto.activeSourceIds.length > 0
        ? dto.activeSourceIds
        : session.activeSourceIds;

    // Fetch recent conversation history (last 10 exchanges)
    const history = await this.prisma.dialogueMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    history.reverse();

    // ─── RAG retrieval ───────────────────────────────────────
    // Stage 06: route through the shared grounded-generation
    // contract. We pull the raw `RetrievedChunk[]` (which carries
    // `modality`) — then `GroundedEvidenceService.buildEvidence`
    // splits it into text contextChunks + image attachments per the
    // env / per-course `RAG_MULTIMODAL_GENERATION` flag.
    let retrievedChunks: RetrievedChunk[] = [];
    const citations: Array<{
      chunkId: string;
      documentId: string;
      documentName: string;
      pageNumber: number | null;
      excerpt: string;
      score: number;
    }> = [];

    if (activeSourceIds.length > 0) {
      retrievedChunks = await this.retrieveStudentChunksRaw(
        studentId,
        session.courseId,
        activeSourceIds,
        dto.content,
        dblSettings.topKChunks,
      );

      for (const c of retrievedChunks) {
        citations.push({
          chunkId: c.chunkId,
          documentId: c.documentId,
          documentName: c.documentName,
          pageNumber: c.pageNumber,
          excerpt: c.content.substring(0, 200),
          score: c.score,
        });
      }
    }

    const teacherId = course.teacherId;

    // Stage 06 — build the shared evidence shape (text + images).
    const imageMeta = await loadImageChunkMetadata(this.prisma, retrievedChunks);
    const evidence = await this.groundedEvidence.buildEvidence(
      retrievedChunks,
      imageMeta,
    );

    const systemPersona = this.buildDialoguePersona(dblSettings);
    const grounded = buildGroundedMessages({
      systemPersona,
      contextChunks: evidence.contextChunks,
      images: evidence.images,
      history: history.map((m) => ({
        role: m.role === 'USER' ? ('user' as const) : ('assistant' as const),
        content: m.content,
      })),
      question: dto.content,
    });

    // First-pass generation.
    const firstPass = await this.llmService.callLlmStructured(
      teacherId,
      {
        systemPrompt: grounded.systemPrompt,
        messages: grounded.messages,
      },
      {
        feature: 'dialogue_chat',
        courseId: session.courseId,
        triggeredByUserId: studentId,
      },
    );

    let assistantContent = firstPass.content;
    let promptTokens = firstPass.promptTokens;
    let completionTokens = firstPass.completionTokens;
    const faithfulnessLog: {
      fired: boolean;
      passed?: boolean;
      regenerated?: boolean;
    } = { fired: false };

    // Stage 06 Task D — faithfulness self-check. OFF by default for
    // chat (latency-sensitive) per spec; flip with
    // `RAG_FAITHFULNESS_CHECK=true` or per-course override.
    if (
      faithfulnessCheckEnabled('chat', undefined, dblSettings.faithfulnessCheck)
    ) {
      faithfulnessLog.fired = true;
      const contextForJudge = this.flattenEvidenceForJudge(evidence);
      const outcome = await this.faithfulnessCheck.checkFaithfulness({
        answer: assistantContent,
        context: contextForJudge,
        teacherId,
        courseId: session.courseId,
      });
      faithfulnessLog.passed = outcome.supported;
      if (!outcome.supported) {
        // Regenerate once with a stricter addendum.
        const stricter = await this.llmService.callLlmStructured(
          teacherId,
          {
            systemPrompt:
              grounded.systemPrompt +
              buildFaithfulnessRetryAddendum(outcome.unsupportedClaims ?? []),
            messages: grounded.messages,
          },
          {
            feature: 'dialogue_chat_retry',
            courseId: session.courseId,
            triggeredByUserId: studentId,
          },
        );
        assistantContent = stricter.content;
        promptTokens += stricter.promptTokens;
        completionTokens += stricter.completionTokens;
        faithfulnessLog.regenerated = true;
      }
      this.logger.log(
        `faithfulness_check.fired=true passed=${faithfulnessLog.passed} regenerated=${faithfulnessLog.regenerated ?? false}`,
      );
    }

    // Parse any inline citations from the response
    const parsedCitations = this.parseCitations(assistantContent, citations);

    // Save both messages in a transaction
    const [userMsg, assistantMsg] = await this.prisma.$transaction([
      this.prisma.dialogueMessage.create({
        data: {
          sessionId,
          role: 'USER',
          content: dto.content,
        },
      }),
      this.prisma.dialogueMessage.create({
        data: {
          sessionId,
          role: 'ASSISTANT',
          content: assistantContent,
          citations: parsedCitations.length > 0 ? parsedCitations : undefined,
          // Stage 06 — `tokenUsage` now carries multimodal + faithfulness
          // signals alongside the legacy prompt/completion counts so the
          // teacher's review tab can spot runaway image-input cost and
          // judge invocations per turn.
          //
          // Shape:
          //   {
          //     promptTokens: number,
          //     completionTokens: number,
          //     imageCount?: number,            // Stage 06 — # images attached
          //     imageInputBytes?: number,       // Stage 06 — sum of bytes
          //     faithfulnessFired?: boolean,    // Stage 06 — judge ran
          //     faithfulnessPassed?: boolean,
          //     faithfulnessRegenerated?: boolean,
          //   }
          tokenUsage: {
            promptTokens,
            completionTokens,
            imageCount: evidence.images.length,
            imageInputBytes: evidence.totalImageBytes,
            faithfulnessFired: faithfulnessLog.fired,
            faithfulnessPassed: faithfulnessLog.passed,
            faithfulnessRegenerated: faithfulnessLog.regenerated,
          },
        },
      }),
    ]);

    // Fire-and-forget EF text-mining detection on the user message
    this.textMining
      .ingest({
        messageId: userMsg.id,
        sessionId,
        studentId,
        courseId: session.courseId,
        teacherId,
        utterance: dto.content,
      })
      .catch((err) => this.logger.error('text-mining ingest failed', err));

    if (activitySessionId) {
      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId: studentId,
        action: ActivityAction.DIALOGUE_MESSAGE_SENT,
        dialogueSessionId: sessionId,
        metadata: {
          messageText: dto.content,
          role: 'student',
          summary: dto.content.slice(0, 80),
        },
      });

      void this.activityLogService.record({
        sessionId: activitySessionId,
        userId: studentId,
        action: ActivityAction.DIALOGUE_MESSAGE_RECEIVED,
        dialogueSessionId: sessionId,
        metadata: {
          messageText: assistantContent,
          role: 'assistant',
          summary: assistantContent.slice(0, 80),
        },
      });
    }

    // Auto-generate title after first exchange
    if (history.length === 0) {
      await this.autoGenerateTitle(sessionId, dto.content, teacherId, session.courseId);
    }

    // Touch session updatedAt
    await this.prisma.dialogueSession.update({
      where: { id: sessionId },
      data: { updatedAt: new Date() },
    });

    return { userMessage: userMsg, assistantMessage: assistantMsg };
  }

  async getMessages(sessionId: string, studentId: string) {
    await this.verifySessionOwnership(sessionId, studentId);

    return this.prisma.dialogueMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'asc' },
    });
  }

  // ─── Teacher: Course Activity ────────────────────────────

  async getCourseActivity(courseId: string, teacherId: string) {
    // Verify the teacher owns this course
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only view activity for your own courses');
    }

    // Get all enrolled students with their dialogue activity
    const enrollments = await this.prisma.enrollment.findMany({
      where: { courseId },
      include: {
        student: { select: { id: true, name: true, email: true } },
      },
    });

    const results = await Promise.all(
      enrollments.map(async (enrollment) => {
        const studentId = enrollment.studentId;

        const [sessionCount, messageCount, sourceCount, lastSession] = await Promise.all([
          this.prisma.dialogueSession.count({
            where: { studentId, courseId },
          }),
          this.prisma.dialogueMessage.count({
            where: { session: { studentId, courseId } },
          }),
          this.prisma.studentSourceDocument.count({
            where: { studentId, courseId },
          }),
          this.prisma.dialogueSession.findFirst({
            where: { studentId, courseId },
            orderBy: { updatedAt: 'desc' },
            select: { updatedAt: true },
          }),
        ]);

        return {
          studentId,
          studentName: enrollment.student.name,
          studentEmail: enrollment.student.email,
          sessionCount,
          messageCount,
          sourceCount,
          lastActiveAt: lastSession?.updatedAt?.toISOString() || null,
        };
      }),
    );

    return results.sort((a, b) => {
      if (!a.lastActiveAt && !b.lastActiveAt) return 0;
      if (!a.lastActiveAt) return 1;
      if (!b.lastActiveAt) return -1;
      return new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime();
    });
  }

  // ─── Helpers ──────────────────────────────────────────────

  /**
   * Stage 06 — Build the dialogue-mode persona that slots in front of
   * the shared grounding contract via `buildGroundedMessages`. This
   * is the ONLY per-surface variable; the grounding rules + citation
   * format come from `GROUNDING_CONTRACT` and are identical across
   * dialogue / chatbot / interventions.
   *
   * The teacher's `systemPromptOverride` (or our baseline tutor
   * persona) sets the tone, plus the formatting block we've always
   * shipped to the dialogue ChatPanel. We deliberately drop the old
   * `citationMode` per-course knob — Stage 06 mandates a single
   * citation format everywhere; the knob was already a UX wart.
   */
  private buildDialoguePersona(settings: DialogueCourseSettings): string {
    const base =
      settings.systemPromptOverride ||
      `You are an intelligent learning assistant helping a student understand their study materials. ` +
        `Be conversational, encouraging, and Socratic. Ask clarifying questions when helpful.`;

    const formattingInstruction =
      `Formatting:\n` +
      `- Use Markdown (headings, bold, lists, blockquotes, links).\n` +
      `- Use GFM pipe tables for comparisons.\n` +
      `- Use fenced code blocks with a language tag (\`\`\`python) for code.\n` +
      `- Use LaTeX for math: $...$ inline, $$...$$ for display equations.`;

    return `${base}\n\n${formattingInstruction}`;
  }

  /** Stage 06 — flatten the grounded evidence into a single string
   *  the faithfulness judge can score the answer against. Mirrors
   *  what `buildGroundedMessages` puts on the user message minus the
   *  conversation history. */
  private flattenEvidenceForJudge(evidence: {
    contextChunks: Array<{ citationLabel: string; text: string; caption?: string }>;
    images: Array<{ citationLabel: string; caption?: string }>;
  }): string {
    const lines: string[] = [];
    for (const c of evidence.contextChunks) {
      lines.push(`[${c.citationLabel}]`);
      if (c.text) lines.push(c.text);
      if (c.caption) lines.push(`(caption: ${c.caption})`);
      lines.push('');
    }
    for (const img of evidence.images) {
      lines.push(`[${img.citationLabel}]`);
      lines.push('(image attached)');
      if (img.caption) lines.push(`(caption: ${img.caption})`);
      lines.push('');
    }
    return lines.join('\n');
  }

  private parseCitations(
    response: string,
    availableCitations: Array<{
      chunkId: string;
      documentId: string;
      documentName: string;
      pageNumber: number | null;
      excerpt: string;
      score: number;
    }>,
  ): Array<{
    chunkId: string;
    documentId: string;
    documentName: string;
    pageNumber: number | null;
    excerpt: string;
    score: number;
  }> {
    if (availableCitations.length === 0) return [];

    // Stage 06 — accept BOTH text citations (`[Source N: name, p.X]`)
    // and visual citations (`[Figure: name, p.X]`). Same shape as the
    // frontend renderer's regex.
    const citationRegex = /\[(?:Source\s*\d*|Figure):\s*([^,\]]+?)(?:,\s*p\.(\d+))?\]/gi;
    const matches = [...response.matchAll(citationRegex)];
    if (matches.length === 0) return availableCitations;

    const referenced = new Set<string>();
    for (const match of matches) {
      const docName = match[1]?.trim().toLowerCase() ?? '';
      for (const c of availableCitations) {
        if (c.documentName.toLowerCase().includes(docName)) {
          referenced.add(c.chunkId);
        }
      }
    }

    return referenced.size > 0
      ? availableCitations.filter((c) => referenced.has(c.chunkId))
      : availableCitations;
  }

  private async autoGenerateTitle(
    sessionId: string,
    firstMessage: string,
    teacherId: string,
    courseId: string,
  ) {
    try {
      const { content: title } = await this.llmService.callLlmForUser(
        teacherId,
        'Generate a very short title (max 6 words) for this conversation. Return ONLY the title, no quotes.',
        `Student message: ${firstMessage.substring(0, 200)}`,
        { feature: 'dialogue_title', courseId },
      );

      const cleanTitle = title
        .trim()
        .replace(/^["']|["']$/g, '')
        .substring(0, 200);
      if (cleanTitle) {
        await this.prisma.dialogueSession.update({
          where: { id: sessionId },
          data: { title: cleanTitle },
        });
      }
    } catch (err) {
      this.logger.warn(`Failed to auto-generate title for session ${sessionId}`, err);
    }
  }

  private async verifyEnrollment(studentId: string, courseId: string) {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });
    if (!enrollment) {
      throw new ForbiddenException('You are not enrolled in this course');
    }
    return enrollment;
  }

  private async verifySessionOwnership(sessionId: string, studentId: string) {
    const session = await this.prisma.dialogueSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException(`Session ${sessionId} not found`);
    if (session.studentId !== studentId) {
      throw new ForbiddenException('Not your session');
    }
    return session;
  }

  private parseDblSettings(raw: unknown): DialogueCourseSettings {
    const result = DialogueCourseSettingsSchema.safeParse(raw || {});
    return result.success ? result.data : DialogueCourseSettingsSchema.parse({});
  }

  /**
   * Stage 06 — return raw `RetrievedChunk[]` (carries `modality`) so
   * the grounded-evidence builder can split into text + image
   * attachments. Drops the flat-shape conversion the old
   * `retrieveStudentChunks` did because every caller now goes
   * through `GroundedEvidenceService.buildEvidence`.
   *
   * Fallback path: when the shared retriever returns nothing OR
   * `RAG_USE_SHARED_RETRIEVER=false`, we synthesise `RetrievedChunk`s
   * from the legacy keyword scorer so the rest of the pipeline
   * doesn't need to branch.
   */
  private async retrieveStudentChunksRaw(
    studentId: string,
    courseId: string,
    sourceIds: string[],
    query: string,
    topK: number,
  ): Promise<RetrievedChunk[]> {
    if (sharedRetrieverEnabled()) {
      const haveEmbeddings = await this.corpusHasEmbeddings(studentId, courseId, sourceIds);
      if (haveEmbeddings) {
        try {
          const course = await this.prisma.course.findUnique({
            where: { id: courseId },
            select: { teacherId: true },
          });
          const teacherId = course?.teacherId;
          const creds = teacherId
            ? await this.embeddingService.resolveTeacherEmbeddingSpec(teacherId)
            : null;
          const apiKey = creds?.apiKey ?? '';
          const provider = creds?.provider ?? 'fallback';
          const out = await this.studentRagRetrieval.retrieveWithMeta(
            query,
            studentId,
            courseId,
            sourceIds,
            topK,
            apiKey,
            provider,
            teacherId,
          );
          if (out.chunks.length > 0) {
            if (out.meta.degradedRetrieval || out.meta.mixedIndexChunkCount > 0) {
              this.logger.warn(
                `dialogue.retrieveStudentChunks: degraded=${out.meta.degradedRetrieval} mixed=${out.meta.mixedIndexChunkCount}`,
              );
            }
            return out.chunks;
          }
        } catch (err) {
          this.logger.warn(
            `Shared retriever failed; falling back to keyword scorer: ${(err as Error).message}`,
          );
        }
      }
    }

    // Legacy keyword fallback — synthesise `RetrievedChunk` shape so
    // downstream code doesn't branch. All keyword hits are `text`
    // modality (legacy corpus has no image chunks).
    const flat = await this.retrieveStudentChunksKeywordLegacy(
      studentId,
      courseId,
      sourceIds,
      query,
      topK,
    );
    return flat.map((c) => ({
      chunkId: c.id,
      documentId: c.documentId,
      documentName: c.documentName,
      content: c.content,
      pageNumber: c.pageNumber,
      score: c.score,
      metadata: {},
      modality: 'text' as const,
    }));
  }

  /**
   * Stage 02 legacy fallback. Original keyword-only scorer preserved
   * so:
   *   - operators can rollback via `RAG_USE_SHARED_RETRIEVER=false`,
   *   - corpora without embeddings (no LLM key + prod with the pseudo-
   *     fallback gated off) still return SOMETHING grounded.
   */
  private async retrieveStudentChunksKeywordLegacy(
    studentId: string,
    courseId: string,
    sourceIds: string[],
    query: string,
    topK: number,
  ) {
    const chunks = await this.prisma.studentRagChunk.findMany({
      where: {
        studentId,
        courseId,
        documentId: { in: sourceIds },
      },
      include: {
        document: { select: { id: true, originalName: true } },
      },
    });

    if (chunks.length === 0) return [];

    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scored = chunks.map((chunk) => {
      // Stage 03 — Contextual Retrieval. Score over
      // `contextualText + content` so that lexical hits on the
      // doc-aware blurb count too. When `contextualText` is NULL
      // (Stage 02 corpora / feature disabled / failure path), the
      // haystack is bare content — identical to the pre-Stage-03
      // scorer.
      const haystack = `${chunk.contextualText ?? ''} ${chunk.content}`;
      const haystackLower = haystack.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        const count = (haystackLower.match(new RegExp(term, 'g')) || []).length;
        score += count;
      }
      score = score / Math.sqrt(haystack.length / 100);

      return {
        id: chunk.id,
        documentId: chunk.documentId,
        documentName: chunk.document.originalName,
        pageNumber: chunk.pageNumber,
        // Generator-facing payload is the original `content` only —
        // the contextualisation blurb is a retrieval aid, not
        // content to quote.
        content: chunk.content,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }

  private async corpusHasEmbeddings(
    studentId: string,
    courseId: string,
    sourceIds: string[],
  ): Promise<boolean> {
    if (sourceIds.length === 0) return false;
    // Prisma JSON-null sentinel: `Prisma.JsonNull` matches NULL columns.
    // We want rows where `embedding` is NOT NULL — so filter on
    // `{ not: Prisma.JsonNull }`.
    const found = await this.prisma.studentRagChunk.findFirst({
      where: {
        studentId,
        courseId,
        documentId: { in: sourceIds },
        embedding: { not: Prisma.JsonNull },
      },
      select: { id: true },
    });
    return found !== null;
  }
}
