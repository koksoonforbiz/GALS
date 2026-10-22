import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { EfaOccasion, Prisma } from '@prisma/client';
import type {
  PuzzleColourCheckRequest,
  PuzzleNextStep,
  PuzzleOccasion,
  PuzzleQuestionSection,
  PuzzleStartRequest,
} from '@ats/shared';
import { PrismaService } from '../prisma';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction, SERVER_ONLY_ACTIONS } from '../activity-log/activity-action.enum';
import { CourseGateService } from '../course-gates/course-gate.service';
import { EfaAllocationService, formFor } from './allocation.service';
import {
  EFA_NOTICE_ACCEPT_LABEL,
  EFA_NOTICE_PARAGRAPHS,
  EFA_NOTICE_TITLE,
  EFA_NOTICE_VERSION,
} from './consent-notice';
import {
  AnswerError,
  itemsOf,
  missingAnswers,
  sectionsFor,
  validateAnswer,
  type ExtrasQuestionnaire,
} from './questionnaire/questionnaire';

export const BATTERY_VERSION = '2.0';
export const TASK_CODES = ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7'] as const;
const ABANDON_AFTER_MS = 24 * 3600_000;
const TERMINAL_TASK = new Set(['completed', 'interrupted', 'skipped']);
const COLOUR_ITEMS = ['COLOUR1', 'COLOUR2', 'COLOUR3'];

export interface EfaConfig {
  enabledOccasions: Record<PuzzleOccasion, boolean>;
  enabledTasks: string[];
  showDiagnosisItem: boolean;
  adexiAtT2: boolean;
  t2MinMinutesAfterPrevious: number;
}

export const DEFAULT_EFA_CONFIG: EfaConfig = {
  enabledOccasions: { T0: true, T1: false, T2: true },
  enabledTasks: [...TASK_CODES],
  showDiagnosisItem: false,
  adexiAtT2: false,
  t2MinMinutesAfterPrevious: 0,
};

/** What the student page needs about one occasion. Neutral by design. */
export interface PuzzleOccasionView {
  occasionId: string | null;
  occasion: PuzzleOccasion;
  next: PuzzleNextStep;
  puzzleCount: number;
  notice?: { version: string; title: string; paragraphs: readonly string[]; acceptLabel: string };
  message?: string;
}

@Injectable()
export class EfaOccasionService {
  private stimulusCache: { sha256: string; extras: { questionnaire: ExtrasQuestionnaire } } | null =
    null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly allocation: EfaAllocationService,
    private readonly gates: CourseGateService,
    private readonly activityLog: ActivityLogService,
  ) {}

  // ── reference data ──────────────────────────────────────────────────────

  async stimulusSet() {
    if (this.stimulusCache) return this.stimulusCache;
    const set = await this.prisma.efaStimulusSet.findFirst({
      where: { batteryVersion: BATTERY_VERSION },
      orderBy: { seededAt: 'desc' },
      select: { sha256: true, extras: true },
    });
    if (!set)
      throw new ConflictException(
        'The puzzles are not available yet. Please contact your instructor.',
      );
    this.stimulusCache = { sha256: set.sha256, extras: set.extras as never };
    return this.stimulusCache;
  }

  async config(courseId: string): Promise<EfaConfig> {
    const row = await this.prisma.efaCourseConfig.findUnique({ where: { courseId } });
    if (!row) return DEFAULT_EFA_CONFIG;
    return {
      enabledOccasions: {
        ...DEFAULT_EFA_CONFIG.enabledOccasions,
        ...(row.enabledOccasions as object),
      },
      enabledTasks: row.enabledTasks,
      showDiagnosisItem: row.showDiagnosisItem,
      adexiAtT2: row.adexiAtT2,
      t2MinMinutesAfterPrevious: row.t2MinMinutesAfterPrevious,
    };
  }

  // ── helpers ─────────────────────────────────────────────────────────────

  private async assertEnrolled(studentId: string, courseId: string) {
    const e = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { status: true },
    });
    if (e?.status !== 'ACTIVE') throw new ForbiddenException('You are not enrolled in this course');
  }

  /** Load the student's own occasion; marks it abandoned after 24 h idle (lazy, no scheduler). */
  private async ownOccasion(studentId: string, occasionId: string): Promise<EfaOccasion> {
    const o = await this.prisma.efaOccasion.findUnique({ where: { id: occasionId } });
    if (!o || o.studentId !== studentId) throw new NotFoundException('Not found');
    return this.applyAbandon(o);
  }

  private async applyAbandon(o: EfaOccasion): Promise<EfaOccasion> {
    const last = o.lastActivityAt ?? o.startedAt;
    if (o.status === 'completed' || o.status === 'abandoned' || !last) return o;
    if (Date.now() - last.getTime() < ABANDON_AFTER_MS) return o;
    return this.prisma.efaOccasion.update({
      where: { id: o.id },
      data: { status: 'abandoned', abandonedAt: new Date() },
    });
  }

  private assertOpen(o: EfaOccasion) {
    if (o.status === 'abandoned') {
      throw new ConflictException('This session has expired. Please contact your instructor.');
    }
    if (o.status === 'completed') throw new ConflictException('Already completed');
  }

  private touch(id: string, extra: Prisma.EfaOccasionUpdateInput = {}) {
    return this.prisma.efaOccasion.update({
      where: { id },
      data: { lastActivityAt: new Date(), ...extra },
    });
  }

  private async log(
    sessionId: string | undefined,
    studentId: string,
    courseId: string,
    action: ActivityAction,
    metadata: Record<string, unknown>,
  ) {
    if (!sessionId) return;
    await this.activityLog.record({ sessionId, userId: studentId, action, courseId, metadata });
  }

  private async tasksDone(o: EfaOccasion, cfg: EfaConfig): Promise<boolean> {
    const runs = await this.prisma.efaTaskRun.findMany({
      where: { occasionId: o.id },
      select: { taskCode: true, status: true },
    });
    return cfg.enabledTasks.every((t) =>
      runs.some((r) => r.taskCode === t && TERMINAL_TASK.has(r.status)),
    );
  }

  private async nextStep(o: EfaOccasion | null, cfg: EfaConfig): Promise<PuzzleNextStep> {
    if (!o || !o.consentedAt) return 'consent';
    if (o.status === 'abandoned') return 'abandoned';
    if (o.status === 'completed') return 'done';
    if (o.status === 'not_started') return 'questionnaire';
    if (cfg.enabledTasks.includes('w6')) {
      const colour = await this.prisma.efaAnswer.count({
        where: { occasionId: o.id, itemCode: { in: COLOUR_ITEMS } },
      });
      if (colour < 3) return 'colour';
    }
    if (!(await this.tasksDone(o, cfg))) return 'tasks';
    return 'after';
  }

  // ── student API ─────────────────────────────────────────────────────────

  async view(
    studentId: string,
    courseId: string,
    occasion: PuzzleOccasion,
  ): Promise<PuzzleOccasionView> {
    await this.assertEnrolled(studentId, courseId);
    const cfg = await this.config(courseId);
    const base = { occasion, puzzleCount: cfg.enabledTasks.length };
    if (!cfg.enabledOccasions[occasion]) {
      return {
        ...base,
        occasionId: null,
        next: 'unavailable',
        message: 'Nothing to do here at the moment.',
      };
    }
    let o = await this.prisma.efaOccasion.findUnique({
      where: { studentId_courseId_occasion: { studentId, courseId, occasion } },
    });
    if (o) o = await this.applyAbandon(o);
    const next = await this.nextStep(o, cfg);
    return {
      ...base,
      occasionId: o?.id ?? null,
      next,
      ...(next === 'consent'
        ? {
            notice: {
              version: EFA_NOTICE_VERSION,
              title: EFA_NOTICE_TITLE,
              paragraphs: EFA_NOTICE_PARAGRAPHS,
              acceptLabel: EFA_NOTICE_ACCEPT_LABEL,
            },
          }
        : {}),
    };
  }

  /** Milliseconds since the student's last course activity (server-only actions excluded). */
  private async gapSinceLastActivity(studentId: string, courseId: string): Promise<number | null> {
    const last = await this.prisma.activityLog.findFirst({
      where: { userId: studentId, courseId, action: { notIn: [...SERVER_ONLY_ACTIONS] as never } },
      orderBy: { occurredAt: 'desc' },
      select: { occurredAt: true },
    });
    return last ? Date.now() - last.occurredAt.getTime() : null;
  }

  async start(
    studentId: string,
    courseId: string,
    occasion: PuzzleOccasion,
    dto: PuzzleStartRequest,
    sessionId?: string,
  ): Promise<PuzzleOccasionView> {
    await this.assertEnrolled(studentId, courseId);
    const cfg = await this.config(courseId);
    if (!cfg.enabledOccasions[occasion])
      throw new ConflictException('Nothing to do here at the moment.');
    if (dto.noticeVersion !== EFA_NOTICE_VERSION) {
      throw new BadRequestException(
        'The notice has changed. Please reload the page and read it again.',
      );
    }
    const existing = await this.prisma.efaOccasion.findUnique({
      where: { studentId_courseId_occasion: { studentId, courseId, occasion } },
    });
    if (existing?.consentedAt) return this.view(studentId, courseId, occasion); // already started: resume

    // Only when it is this occasion's turn in the course (gates are a strict sequence).
    const steps = await this.gates.studentSteps(studentId, courseId);
    const mine = steps.find((s) => s.step === 'questionnaire' && s.occasion === occasion);
    if (mine && !mine.next && !mine.done) {
      throw new ConflictException('Please complete the earlier steps of the course first.');
    }

    const gapMs = await this.gapSinceLastActivity(studentId, courseId);
    if (occasion === 'T2' && cfg.t2MinMinutesAfterPrevious > 0 && gapMs != null) {
      const waitMin = Math.ceil(cfg.t2MinMinutesAfterPrevious - gapMs / 60_000);
      if (waitMin > 0) {
        throw new ConflictException(
          `Please take a short break first. You can start in about ${waitMin} minute(s).`,
        );
      }
    }

    const slot =
      occasion === 'T0'
        ? await this.allocation.claim(studentId, courseId)
        : ((await this.allocation.current(studentId, courseId)) ??
          (await this.allocation.claim(studentId, courseId)));
    if (!slot)
      throw new ConflictException(
        'The puzzles are not available yet. Please contact your instructor.',
      );

    const { sha256 } = await this.stimulusSet();
    const now = new Date();
    const data = {
      status: 'not_started' as const,
      form: formFor(slot, occasion),
      orderCode: slot.orderCode,
      slot: slot.slot,
      batteryVersion: BATTERY_VERSION,
      stimuliSha256: sha256,
      consentVersion: EFA_NOTICE_VERSION,
      consentedAt: now,
      device: dto.device as unknown as Prisma.InputJsonValue,
      fullscreenAccepted: dto.device.fullscreenAccepted,
      sensingPaused: true,
      gapSincePreviousActivityMs: gapMs == null ? null : BigInt(Math.round(gapMs)),
      startedAt: now,
      lastActivityAt: now,
    };
    const o = existing
      ? await this.prisma.efaOccasion.update({ where: { id: existing.id }, data })
      : await this.prisma.efaOccasion.create({ data: { studentId, courseId, occasion, ...data } });
    await this.log(sessionId, studentId, courseId, ActivityAction.EF_OCCASION_STARTED, {
      occasion,
    });
    return this.view(studentId, courseId, o.occasion);
  }

  private async sections(
    o: EfaOccasion,
    part: 'before' | 'after',
  ): Promise<PuzzleQuestionSection[]> {
    const [{ extras }, cfg] = await Promise.all([this.stimulusSet(), this.config(o.courseId)]);
    return sectionsFor(extras.questionnaire, o.occasion, part, cfg);
  }

  async questionnaire(studentId: string, occasionId: string, part: 'before' | 'after') {
    const o = await this.ownOccasion(studentId, occasionId);
    this.assertOpen(o);
    if (!o.consentedAt) throw new ConflictException('Please read and accept the notice first.');
    const sections = await this.sections(o, part);
    const codes = itemsOf(sections).map((i) => i.code);
    const saved = await this.prisma.efaAnswer.findMany({
      where: { occasionId, itemCode: { in: codes } },
      select: { itemCode: true, value: true },
    });
    const { extras } = await this.stimulusSet();
    return {
      title: extras.questionnaire.title,
      footer: extras.questionnaire.footer,
      sections,
      answers: Object.fromEntries(saved.map((a) => [a.itemCode, a.value])),
    };
  }

  async saveAnswer(studentId: string, occasionId: string, itemCode: string, value: unknown) {
    const o = await this.ownOccasion(studentId, occasionId);
    this.assertOpen(o);
    const part = o.status === 'not_started' ? 'before' : 'after';
    const item = itemsOf(await this.sections(o, part)).find((i) => i.code === itemCode);
    if (!item) throw new BadRequestException('That question is not part of this step');
    let clean: unknown;
    try {
      clean = validateAnswer(item, value);
    } catch (e) {
      if (e instanceof AnswerError) throw new BadRequestException(e.message);
      throw e;
    }
    await this.prisma.efaAnswer.upsert({
      where: { occasionId_itemCode: { occasionId, itemCode } },
      create: { occasionId, itemCode, value: clean as Prisma.InputJsonValue },
      update: { value: clean as Prisma.InputJsonValue, answeredAt: new Date() },
    });
    await this.touch(occasionId);
    return { itemCode, saved: true };
  }

  async submit(
    studentId: string,
    occasionId: string,
    part: 'before' | 'after',
    sessionId?: string,
  ) {
    const o = await this.ownOccasion(studentId, occasionId);
    this.assertOpen(o);
    const cfg = await this.config(o.courseId);
    if (part === 'before' && o.status !== 'not_started')
      return this.view(studentId, o.courseId, o.occasion);
    if (part === 'after' && !(await this.tasksDone(o, cfg))) {
      throw new ConflictException('Please finish the puzzles first.');
    }
    const sections = await this.sections(o, part);
    const answered = await this.prisma.efaAnswer.findMany({
      where: { occasionId },
      select: { itemCode: true },
    });
    const missing = missingAnswers(sections, new Set(answered.map((a) => a.itemCode)));
    if (missing.length) {
      throw new BadRequestException({ message: 'Please answer every question.', missing });
    }

    if (part === 'before') {
      await this.touch(occasionId, {
        status: 'questionnaire_done',
        questionnaireDoneAt: new Date(),
      });
      await this.gates.completeByKind(o.courseId, 'EF_QUESTIONNAIRE', o.occasion, studentId);
      await this.log(sessionId, studentId, o.courseId, ActivityAction.EF_QUESTIONNAIRE_SUBMITTED, {
        occasion: o.occasion,
        items: itemsOf(sections).length,
      });
    } else {
      await this.touch(occasionId, { status: 'completed', completedAt: new Date() });
      await this.gates.completeByKind(o.courseId, 'EF_TESTS', o.occasion, studentId);
      await this.log(sessionId, studentId, o.courseId, ActivityAction.EF_OCCASION_COMPLETED, {
        occasion: o.occasion,
        durationMs: o.startedAt ? Date.now() - o.startedAt.getTime() : null,
      });
    }
    return this.view(studentId, o.courseId, o.occasion);
  }

  /**
   * Colour naming check before the colour puzzle: three patches in a
   * client-randomised order with fixed labels. Any wrong answer skips that
   * puzzle for this occasion (flag colourCheckFailed); recorded once.
   */
  async colourCheck(studentId: string, occasionId: string, dto: PuzzleColourCheckRequest) {
    const o = await this.ownOccasion(studentId, occasionId);
    this.assertOpen(o);
    if (o.status === 'not_started')
      throw new ConflictException('Please finish the questionnaire first.');
    const done = await this.prisma.efaAnswer.count({
      where: { occasionId, itemCode: { in: COLOUR_ITEMS } },
    });
    if (done) throw new ConflictException('Already done');

    const passed = dto.answers.every((a) => a.shown === a.chosen);
    await this.prisma.$transaction([
      ...dto.answers.map((a, i) =>
        this.prisma.efaAnswer.create({
          data: {
            occasionId,
            itemCode: COLOUR_ITEMS[i]!,
            value: { shown: a.shown, chosen: a.chosen },
          },
        }),
      ),
      this.prisma.efaOccasion.update({
        where: { id: occasionId },
        data: {
          lastActivityAt: new Date(),
          flags: { ...((o.flags as object) ?? {}), colourCheckFailed: !passed },
        },
      }),
    ]);
    if (!passed) {
      await this.prisma.efaTaskRun.upsert({
        where: { occasionId_taskCode_attemptNo: { occasionId, taskCode: 'w6', attemptNo: 1 } },
        create: {
          occasionId,
          taskCode: 'w6',
          status: 'skipped',
          skipReason: 'colour_check_failed',
        },
        update: {},
      });
    }
    return this.view(studentId, o.courseId, o.occasion);
  }
}
