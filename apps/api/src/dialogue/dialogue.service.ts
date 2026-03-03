import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { LlmService } from '../rag/llm.service';
import { RagService } from '../rag/rag.service';
import type { DialogueCourseSettings } from '@ats/shared';
import { DialogueCourseSettingsSchema } from '@ats/shared';
import type { CreateSessionDto, SendMessageDto } from './dto';

@Injectable()
export class DialogueService {
  private readonly logger = new Logger(DialogueService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly ragService: RagService,
  ) {}

  // ─── Session CRUD ─────────────────────────────────────────

  async createSession(studentId: string, courseId: string, dto: CreateSessionDto) {
    const enrollment = await this.verifyEnrollment(studentId, courseId);

    return this.prisma.dialogueSession.create({
      data: {
        enrollmentId: enrollment.id,
        studentId,
        courseId,
        title: dto.title || 'New Session',
        activeSourceIds: dto.activeSourceIds || [],
      },
      include: { _count: { select: { messages: true, studioOutputs: true } } },
    });
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

  async sendMessage(sessionId: string, studentId: string, dto: SendMessageDto) {
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

    // RAG retrieval from student documents
    let ragContext = '';
    const citations: Array<{
      chunkId: string;
      documentId: string;
      documentName: string;
      pageNumber: number | null;
      excerpt: string;
      score: number;
    }> = [];

    if (activeSourceIds.length > 0) {
      const chunks = await this.retrieveStudentChunks(
        studentId,
        session.courseId,
        activeSourceIds,
        dto.content,
        dblSettings.topKChunks,
      );

      if (chunks.length > 0) {
        ragContext = chunks
          .map(
            (c, i) =>
              `[Source ${i + 1}: ${c.documentName}, p.${c.pageNumber ?? '?'}]\n${c.content}`,
          )
          .join('\n\n');

        for (const c of chunks) {
          citations.push({
            chunkId: c.id,
            documentId: c.documentId,
            documentName: c.documentName,
            pageNumber: c.pageNumber,
            excerpt: c.content.substring(0, 200),
            score: c.score,
          });
        }
      }
    }

    // Build prompts
    const systemPrompt = this.buildSystemPrompt(dblSettings, ragContext);
    const llmMessages = this.buildLlmMessages(history, dto.content);

    // Get teacher credentials for LLM call
    const teacherId = course.teacherId;

    const {
      content: assistantContent,
      promptTokens,
      completionTokens,
    } = await this.llmService.callLlmForUser(teacherId, systemPrompt, llmMessages, {
      feature: 'dialogue_chat',
      courseId: session.courseId,
      triggeredByUserId: studentId,
    });

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
          tokenUsage: { promptTokens, completionTokens },
        },
      }),
    ]);

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

  private buildSystemPrompt(settings: DialogueCourseSettings, ragContext: string): string {
    const base =
      settings.systemPromptOverride ||
      `You are an intelligent learning assistant helping a student understand their study materials. ` +
        `Be conversational, encouraging, and Socratic. Ask clarifying questions when helpful. ` +
        `Always ground your answers in the provided source material when available.`;

    const citationInstruction =
      settings.citationMode === 'inline'
        ? `\nWhen referencing source material, use inline citations like [Source: DocName, p.X].`
        : settings.citationMode === 'footnote'
          ? `\nUse footnote-style citations numbered [1], [2], etc. at the end of your response.`
          : '';

    const contextBlock = ragContext
      ? `\n\n--- STUDENT DOCUMENTS ---\n${ragContext}\n--- END DOCUMENTS ---`
      : '';

    return base + citationInstruction + contextBlock;
  }

  private buildLlmMessages(
    history: Array<{ role: string; content: string }>,
    newMessage: string,
  ): string {
    // Build a single user prompt that includes conversation history
    const historyStr = history
      .map((m) => `${m.role === 'USER' ? 'Student' : 'Assistant'}: ${m.content}`)
      .join('\n\n');

    return historyStr ? `${historyStr}\n\nStudent: ${newMessage}` : `Student: ${newMessage}`;
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

    // Match [Source: DocName, p.X] or [Source N: DocName, p.X]
    const citationRegex = /\[Source\s*\d*:\s*([^,\]]+?)(?:,\s*p\.(\d+))?\]/gi;
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

  private async retrieveStudentChunks(
    studentId: string,
    courseId: string,
    sourceIds: string[],
    query: string,
    topK: number,
  ) {
    // Retrieve chunks from student-uploaded documents
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

    // Simple keyword-based scoring
    const queryTerms = query
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);

    const scored = chunks.map((chunk) => {
      const contentLower = chunk.content.toLowerCase();
      let score = 0;
      for (const term of queryTerms) {
        const count = (contentLower.match(new RegExp(term, 'g')) || []).length;
        score += count;
      }
      // Length normalization
      score = score / Math.sqrt(chunk.content.length / 100);

      return {
        id: chunk.id,
        documentId: chunk.documentId,
        documentName: chunk.document.originalName,
        pageNumber: chunk.pageNumber,
        content: chunk.content,
        score,
      };
    });

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, topK);
  }
}
