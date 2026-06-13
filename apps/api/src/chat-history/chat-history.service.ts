import { Injectable, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Student-scoped retrieval of chat history for the "Chat History" /
 * review surface. Covers both standard-mode floating/docked chatbot
 * (`chatbot_messages`) and dialogue mode (`dialogue_messages`).
 *
 * Ownership is enforced HERE in the service: every method filters by
 * `studentId === req.user.id`. The UI is treated as a hint, not a
 * trust boundary — a student must never be able to read another
 * student's history.
 */
@Injectable()
export class ChatHistoryService {
  constructor(private readonly prisma: PrismaService) {}

  // ─── List: groups by surface + session, returns summary cards ─────

  /**
   * Returns a unified list of "conversation cards" for the student.
   * Each card represents either:
   *   - a `StudentSession` that has at least one chatbot_messages row
   *     (standard-mode floating / docked chatbot)
   *   - a `DialogueSession` that has at least one dialogue_messages row
   *     (NotebookLM-style dialogue mode)
   * plus an "orphan" bucket for chatbot rows whose `student_session_id`
   * was nulled out by a session purge — those still belong to the
   * student and should still be reviewable.
   *
   * Sorted by `lastMessageAt` desc so the most recent conversation is
   * on top. Capped to a sensible default — paginate further if the
   * platform ever needs it; today no student has thousands of
   * conversations.
   */
  async listConversations(studentId: string): Promise<{
    items: ConversationSummary[];
    total: number;
  }> {
    // ── 1. Chatbot side: group by studentSessionId ─────────────────
    // Prisma doesn't support grouping with relation includes well, so we
    // group at the DB then enrich in a second roundtrip. Cheap enough
    // for the volume we expect here.
    const chatbotGroups = await this.prisma.chatbotMessage.groupBy({
      by: ['studentSessionId'],
      where: { studentId },
      _count: { _all: true },
      _max: { createdAt: true },
      _min: { createdAt: true },
    });

    const sessionIds = chatbotGroups
      .map((g) => g.studentSessionId)
      .filter((id): id is string => !!id);

    const sessions =
      sessionIds.length > 0
        ? await this.prisma.studentSession.findMany({
            where: { id: { in: sessionIds }, userId: studentId },
            select: {
              id: true,
              courseId: true,
              startedAt: true,
              endedAt: true,
              course: { select: { id: true, title: true } },
            },
          })
        : [];
    const sessionMap = new Map(sessions.map((s) => [s.id, s]));

    // Pull a single snippet (first assistant or first user message) for
    // each conversation so the list view has something to show.
    const snippetRows = await this.prisma.chatbotMessage.findMany({
      where: { studentId },
      orderBy: { createdAt: 'asc' },
      select: {
        studentSessionId: true,
        content: true,
        role: true,
        courseId: true,
        moduleItemId: true,
      },
    });
    const firstSnippetBySession = new Map<string | 'orphan', { content: string; courseId: string | null }>();
    for (const r of snippetRows) {
      const key = r.studentSessionId ?? 'orphan';
      if (!firstSnippetBySession.has(key)) {
        firstSnippetBySession.set(key, {
          content: r.content,
          courseId: r.courseId,
        });
      }
    }

    const chatbotItems: ConversationSummary[] = chatbotGroups.map((g) => {
      const key = g.studentSessionId ?? 'orphan';
      const session = g.studentSessionId ? sessionMap.get(g.studentSessionId) : undefined;
      const snippet = firstSnippetBySession.get(key);
      return {
        surface: 'chatbot' as const,
        id: g.studentSessionId ?? `orphan-${studentId}`,
        title:
          session?.course?.title ??
          (g.studentSessionId
            ? 'Standard-mode chat'
            : 'Standard-mode chat (session ended)'),
        courseId: session?.courseId ?? snippet?.courseId ?? null,
        courseTitle: session?.course?.title ?? null,
        messageCount: g._count._all,
        startedAt: (g._min.createdAt ?? new Date()).toISOString(),
        lastMessageAt: (g._max.createdAt ?? new Date()).toISOString(),
        snippet: snippet?.content ? truncate(snippet.content, 140) : null,
      };
    });

    // ── 2. Dialogue side: every DialogueSession the student owns ───
    const dialogueSessions = await this.prisma.dialogueSession.findMany({
      where: { studentId },
      orderBy: { updatedAt: 'desc' },
      select: {
        id: true,
        title: true,
        courseId: true,
        createdAt: true,
        updatedAt: true,
        course: { select: { id: true, title: true } },
        _count: { select: { messages: true } },
        messages: {
          take: 1,
          orderBy: { createdAt: 'asc' },
          select: { content: true },
        },
      },
    });

    const dialogueItems: ConversationSummary[] = dialogueSessions
      .filter((s) => s._count.messages > 0)
      .map((s) => ({
        surface: 'dialogue' as const,
        id: s.id,
        title: s.title,
        courseId: s.courseId,
        courseTitle: s.course?.title ?? null,
        messageCount: s._count.messages,
        startedAt: s.createdAt.toISOString(),
        lastMessageAt: s.updatedAt.toISOString(),
        snippet: s.messages[0] ? truncate(s.messages[0].content, 140) : null,
      }));

    const all = [...chatbotItems, ...dialogueItems].sort((a, b) =>
      b.lastMessageAt.localeCompare(a.lastMessageAt),
    );

    return { items: all, total: all.length };
  }

  // ─── Detail: full transcript of one conversation ──────────────────

  /**
   * Fetch every turn in a single conversation. `surface` distinguishes
   * which underlying table to read from. The result intentionally
   * mirrors the live chat shape (role + content + createdAt) so the
   * review UI can reuse the same `<ChatMessageContent>` renderer.
   *
   * Pagination: `limit` + `before` (createdAt cursor) supported so a
   * very long session doesn't blow up the response. Default page size
   * is 500 turns which comfortably fits any realistic conversation.
   */
  async getConversation(
    studentId: string,
    surface: 'chatbot' | 'dialogue',
    id: string,
    opts: { limit?: number; before?: string } = {},
  ): Promise<ConversationDetail> {
    const limit = Math.min(Math.max(opts.limit ?? 500, 1), 1000);
    const before = opts.before ? new Date(opts.before) : null;

    if (surface === 'chatbot') {
      // Special id form 'orphan-<studentId>' means "all chatbot rows
      // for this student whose session_id is null". We return them
      // chronologically as one synthetic conversation.
      const isOrphan = id === `orphan-${studentId}`;

      // Ownership enforcement — both branches filter on studentId
      // regardless of what the caller passed.
      if (!isOrphan) {
        const sessionExists = await this.prisma.studentSession.findFirst({
          where: { id, userId: studentId },
          select: { id: true },
        });
        if (!sessionExists) {
          throw new NotFoundException('Conversation not found');
        }
      }

      const rows = await this.prisma.chatbotMessage.findMany({
        where: {
          studentId,
          ...(isOrphan ? { studentSessionId: null } : { studentSessionId: id }),
          ...(before ? { createdAt: { lt: before } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: limit,
        select: {
          id: true,
          role: true,
          content: true,
          createdAt: true,
          contextSource: true,
          selectedText: true,
          currentPage: true,
          suggestedStrategy: true,
          courseId: true,
          moduleItemId: true,
        },
      });

      const session = isOrphan
        ? null
        : await this.prisma.studentSession.findUnique({
            where: { id },
            select: {
              id: true,
              startedAt: true,
              endedAt: true,
              course: { select: { id: true, title: true } },
            },
          });

      return {
        surface: 'chatbot',
        id: isOrphan ? `orphan-${studentId}` : id,
        title:
          session?.course?.title ??
          (isOrphan ? 'Standard-mode chat (session ended)' : 'Standard-mode chat'),
        courseId: session?.course?.id ?? rows[0]?.courseId ?? null,
        courseTitle: session?.course?.title ?? null,
        startedAt: (session?.startedAt ?? rows[0]?.createdAt ?? new Date()).toISOString(),
        endedAt: session?.endedAt?.toISOString() ?? null,
        messages: rows.map((r) => ({
          id: r.id,
          role: r.role,
          content: r.content,
          createdAt: r.createdAt.toISOString(),
          contextSource: r.contextSource,
          selectedText: r.selectedText,
          currentPage: r.currentPage,
          suggestedStrategy: r.suggestedStrategy,
        })),
      };
    }

    // Dialogue surface
    const session = await this.prisma.dialogueSession.findFirst({
      where: { id, studentId },
      select: {
        id: true,
        title: true,
        createdAt: true,
        updatedAt: true,
        course: { select: { id: true, title: true } },
      },
    });
    if (!session) {
      throw new NotFoundException('Conversation not found');
    }

    const rows = await this.prisma.dialogueMessage.findMany({
      where: {
        sessionId: id,
        ...(before ? { createdAt: { lt: before } } : {}),
      },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        role: true,
        content: true,
        createdAt: true,
        citations: true,
      },
    });

    return {
      surface: 'dialogue',
      id: session.id,
      title: session.title,
      courseId: session.course?.id ?? null,
      courseTitle: session.course?.title ?? null,
      startedAt: session.createdAt.toISOString(),
      endedAt: null,
      messages: rows.map((r) => ({
        id: r.id,
        role: r.role,
        content: r.content,
        createdAt: r.createdAt.toISOString(),
        citations: r.citations,
        contextSource: null,
        selectedText: null,
        currentPage: null,
        suggestedStrategy: null,
      })),
    };
  }

  /**
   * Defensive helper used by the controller layer when it doesn't
   * already trust the studentId binding (e.g. future endpoints).
   */
  async assertOwnership(
    studentId: string,
    surface: 'chatbot' | 'dialogue',
    id: string,
  ): Promise<void> {
    if (surface === 'chatbot' && id === `orphan-${studentId}`) return;
    if (surface === 'chatbot') {
      const session = await this.prisma.studentSession.findFirst({
        where: { id, userId: studentId },
        select: { id: true },
      });
      if (!session) throw new ForbiddenException('Not your conversation');
      return;
    }
    const session = await this.prisma.dialogueSession.findFirst({
      where: { id, studentId },
      select: { id: true },
    });
    if (!session) throw new ForbiddenException('Not your conversation');
  }
}

// ─── DTO shapes ─────────────────────────────────────────────────────

export interface ConversationSummary {
  surface: 'chatbot' | 'dialogue';
  id: string;
  title: string;
  courseId: string | null;
  courseTitle: string | null;
  messageCount: number;
  startedAt: string;
  lastMessageAt: string;
  snippet: string | null;
}

export interface ConversationMessage {
  id: string;
  role: string;
  content: string;
  createdAt: string;
  // Surface-specific extras — null on the other surface.
  contextSource?: string | null;
  selectedText?: string | null;
  suggestedStrategy?: string | null;
  citations?: unknown;
}

export interface ConversationDetail {
  surface: 'chatbot' | 'dialogue';
  id: string;
  title: string;
  courseId: string | null;
  courseTitle: string | null;
  startedAt: string;
  endedAt: string | null;
  messages: ConversationMessage[];
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}
