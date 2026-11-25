import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import {
  STUDY_FORM_NOTICE_VERSION,
  TEXT_CONSENT_NOTICE_VERSION,
  type TextConsentDecision,
} from '@ats/shared';
import { PrismaService } from '../prisma';

/**
 * Where consent comes from. By default the study consent form, signed before
 * a learner joins, covers all three uses below: every learner counts as having
 * agreed, no in-app panel is shown and all text is recorded and exported.
 * Set TEXT_CONSENT_IN_APP=true to ask in the app instead (the Phase 6 panel).
 */
export function consentInApp(): boolean {
  return process.env.TEXT_CONSENT_IN_APP === 'true';
}

/** Which consent covers a row's text: stamped on each activity row (B2). */
export function consentScope(): string {
  return consentInApp() ? `in-app:${TEXT_CONSENT_NOTICE_VERSION}` : STUDY_FORM_NOTICE_VERSION;
}

const STUDY_FORM_DECISION: TextConsentDecision = {
  answerText: true,
  promptsAndOutputs: true,
  researchUse: true,
  noticeVersion: STUDY_FORM_NOTICE_VERSION,
  decidedAt: new Date(0).toISOString(),
};

/** Free-text metadata keys a lesson/Prompt Lab event may carry (lessonEvents.ts). */
const TEXT_KEYS = ['text', 'parts'] as const;

/**
 * Free text other course events carry (CAP-30): chatbot turns and the
 * answers typed into the practice-testing and stepwise strategies. Without
 * consent (a) the text is dropped and only its length is kept as `<key>Chars`.
 */
const ACTION_TEXT_KEYS: Record<string, readonly string[]> = {
  CHATBOT_MESSAGE_SENT: ['message'],
  CHATBOT_MESSAGE_RECEIVED: ['reply'],
  QUESTION_ANSWERED: ['answer'],
};

type TextEvent = {
  action?: string;
  courseId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** The free-text keys present on this event (empty when it carries none). */
function textKeysOf(e: TextEvent): string[] {
  const m = e.metadata;
  if (!m) return [];
  const keys: readonly string[] =
    'libraryVersion' in m ? TEXT_KEYS : (ACTION_TEXT_KEYS[e.action ?? ''] ?? []);
  return keys.filter((k) => k in m);
}

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
    if (!consentInApp()) return STUDY_FORM_DECISION;
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
    if (!consentInApp()) return STUDY_FORM_DECISION;
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
    if (!consentInApp()) {
      // Study consent form: everyone enrolled in the course.
      const enrolled = await this.prisma.enrollment.findMany({
        where: { courseId },
        select: { studentId: true },
      });
      return new Set(enrolled.map((e) => e.studentId));
    }
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
   * Server-side gate for the activity-log batch: drops free text from course
   * events unless (a) is given for that course. Lesson/Prompt Lab events
   * (they carry `libraryVersion`) lose `text`/`parts` and keep `chars`;
   * chatbot turns and strategy answers lose the text and keep `<key>Chars`.
   * An event without a courseId has no consent, so its text is dropped too.
   * Every other action passes through unchanged.
   */
  async stripUnconsentedText<E extends TextEvent>(studentId: string, events: E[]): Promise<E[]> {
    if (!consentInApp()) return events;
    const courses = [
      ...new Set(
        events
          .filter((e) => textKeysOf(e).length > 0)
          .map((e) => e.courseId)
          .filter((c): c is string => !!c),
      ),
    ];
    const allowed = new Set<string>();
    for (const c of courses) if ((await this.current(studentId, c))?.answerText) allowed.add(c);
    return events.map((e) => {
      const keys = textKeysOf(e);
      if (keys.length === 0) return e;
      if (e.courseId && allowed.has(e.courseId)) return e;
      const lesson = 'libraryVersion' in e.metadata!;
      const meta = { ...e.metadata };
      for (const k of keys) {
        const v = meta[k];
        if (!lesson && typeof v === 'string') meta[`${k}Chars`] = v.length;
        delete meta[k];
      }
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
    // Study consent form: text is kept, nothing is scrubbed.
    if (!consentInApp()) return { runs: 0, versions: 0, testCases: 0, claims: 0 };
    const session = await this.prisma.studentSession.findUnique({
      where: { id: sessionId },
      select: { userId: true },
    });
    if (!session) return { runs: 0, versions: 0, testCases: 0, claims: 0 };
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
    // The claim a learner checked against a run is their own text too: blank
    // it wherever the run's text is not kept (CAP-30).
    const claims = await this.prisma.promptLabOutputRating.updateMany({
      where: {
        studentId,
        run: { retainText: false },
        verifiedClaim: { not: null },
        NOT: { verifiedClaim: '' },
      },
      data: { verifiedClaim: '' },
    });
    return { runs: runs.count, versions, testCases, claims: claims.count };
  }
}
