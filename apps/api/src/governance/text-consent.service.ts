import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { TEXT_CONSENT_NOTICE_VERSION, type TextConsentDecision } from '@ats/shared';
import { PrismaService } from '../prisma';

/** Free-text metadata keys a lesson/Prompt Lab event may carry (lessonEvents.ts). */
const TEXT_KEYS = ['text', 'parts'] as const;

/**
 * Text-capture consent (plan Phase 6.2 #1), per learner per course:
 *   (a) answerText        — keep submitted answer text in the activity log
 *   (b) promptsAndOutputs — keep Prompt Lab prompts/outputs beyond the session
 *   (c) researchUse       — include my data in research exports and coding
 * No decision = no consent. Rows are append-only; the latest row wins.
 */
@Injectable()
export class TextConsentService {
  private readonly logger = new Logger(TextConsentService.name);

  constructor(private readonly prisma: PrismaService) {}

  async current(studentId: string, courseId: string): Promise<TextConsentDecision | null> {
    const row = await this.prisma.textCaptureConsent.findFirst({
      where: { studentId, courseId },
      orderBy: { decidedAt: 'desc' },
    });
    return row
      ? {
          answerText: row.answerText,
          promptsAndOutputs: row.promptsAndOutputs,
          researchUse: row.researchUse,
          noticeVersion: row.noticeVersion,
          decidedAt: row.decidedAt.toISOString(),
        }
      : null;
  }

  async decide(
    studentId: string,
    courseId: string,
    d: Omit<TextConsentDecision, 'noticeVersion' | 'decidedAt'>,
  ) {
    const enrolled = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { status: true },
    });
    if (enrolled?.status !== 'ACTIVE')
      throw new ForbiddenException('You are not enrolled in this course');
    await this.prisma.textCaptureConsent.create({
      data: { studentId, courseId, ...d, noticeVersion: TEXT_CONSENT_NOTICE_VERSION },
    });
    return this.current(studentId, courseId);
  }

  /** Students whose latest decision for the course allows research use. */
  async researchConsenting(courseId: string): Promise<Set<string>> {
    const rows = await this.prisma.textCaptureConsent.findMany({
      where: { courseId },
      orderBy: { decidedAt: 'asc' },
      select: { studentId: true, researchUse: true },
    });
    const latest = new Map<string, boolean>();
    for (const r of rows) latest.set(r.studentId, r.researchUse);
    return new Set([...latest].filter(([, ok]) => ok).map(([id]) => id));
  }

  /**
   * Server-side gate for the activity-log batch (defence in depth behind the
   * client): drops free text from course events unless (a) is given for that
   * course. Only events that carry `libraryVersion` (lesson/Prompt Lab) are
   * touched; every other action passes through unchanged.
   */
  async stripUnconsentedText<
    E extends { courseId?: string | null; metadata?: Record<string, unknown> | null },
  >(studentId: string, events: E[]): Promise<E[]> {
    const courses = [
      ...new Set(
        events
          .filter(
            (e) =>
              e.metadata &&
              'libraryVersion' in e.metadata &&
              TEXT_KEYS.some((k) => k in e.metadata!),
          )
          .map((e) => e.courseId)
          .filter((c): c is string => !!c),
      ),
    ];
    const allowed = new Set<string>();
    for (const c of courses) if ((await this.current(studentId, c))?.answerText) allowed.add(c);
    return events.map((e) => {
      if (!e.metadata || !('libraryVersion' in e.metadata)) return e;
      if (e.courseId && allowed.has(e.courseId)) return e;
      if (!TEXT_KEYS.some((k) => k in e.metadata!)) return e;
      const meta = { ...e.metadata };
      for (const k of TEXT_KEYS) delete meta[k];
      return { ...e, metadata: meta };
    });
  }

  /**
   * (b) not given: Prompt Lab text is a working copy for the session only.
   * On session close, blank prompts/outputs of that learner's runs marked
   * retainText = false (this session and any older unscrubbed ones), plus
   * their saved versions and test-case inputs in courses without consent.
   * Counts, tokens, diffs, tags and results are kept.
   */
  @OnEvent('session.closed', { async: true })
  async onSessionClosed(payload: { sessionId: string }) {
    try {
      await this.scrubForSession(payload.sessionId);
    } catch (err) {
      this.logger.warn(`text scrub failed for ${payload.sessionId}: ${(err as Error).message}`);
    }
  }

  async scrubForSession(sessionId: string) {
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (!session) return { runs: 0, versions: 0, testCases: 0 };
    const studentId = session.userId;
    const now = new Date();
    const runs = await this.prisma.promptLabRun.updateMany({
      where: { studentId, retainText: false, textScrubbedAt: null },
      data: { promptText: '', responseText: '', systemText: null, textScrubbedAt: now },
    });
    // Versions and test cases: scrub in every course where (b) is not given.
    const courseIds = (
      await this.prisma.promptLabVersion.findMany({
        where: { studentId },
        select: { moduleItem: { select: { module: { select: { courseId: true } } } } },
        distinct: ['moduleItemId'],
      })
    ).map((v) => v.moduleItem.module.courseId);
    let versions = 0;
    let testCases = 0;
    for (const courseId of new Set(courseIds)) {
      if ((await this.current(studentId, courseId))?.promptsAndOutputs) continue;
      const where = { studentId, moduleItem: { module: { courseId } } };
      versions += (
        await this.prisma.promptLabVersion.updateMany({
          where: { ...where, NOT: { promptText: '' } },
          data: { promptText: '' },
        })
      ).count;
      testCases += (
        await this.prisma.promptLabTestCase.updateMany({
          where: { ...where, NOT: { inputText: '' } },
          data: { inputText: '' },
        })
      ).count;
    }
    return { runs: runs.count, versions, testCases };
  }
}
