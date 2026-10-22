import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma';
import { researchPseudonym, researchSalt } from '../../learning-events/exports/exports.service';
import { csvCell } from '../../learning-events/validation/validation.service';
import { EfaOccasionService } from '../occasion.service';
import { SCORING_VERSION, scoreAdexi } from '../scoring/scoring';
import { assertEfaStaff, type EfaStaff } from '../staff-access';

export const EFA_EXPORTS = [
  'trials',
  'task-scores',
  'questionnaire',
  'occasions',
  'coding',
] as const;
export type EfaExport = (typeof EFA_EXPORTS)[number];

const json = (v: unknown) => (v == null ? '' : typeof v === 'object' ? JSON.stringify(v) : v);
const iso = (d: Date | null | undefined) => (d ? d.toISOString() : '');
const toCsv = (header: string[], rows: unknown[][]) =>
  [header, ...rows].map((r) => r.map((c) => csvCell(json(c))).join(',')).join('\n') + '\n';

/**
 * The five EF research exports. Students are pseudonymised exactly like the
 * other research exports (salted SHA-256 of the id, RESEARCH_EXPORT_SALT);
 * raters likewise. Only occasions whose notice was accepted are included:
 * that acceptance is the research consent for EF data (decision Q10).
 * No z-scores or composites: those are computed at analysis time.
 */
@Injectable()
export class EfaExportsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly occasions: EfaOccasionService,
  ) {}

  async csv(
    staff: EfaStaff,
    courseId: string,
    kind: EfaExport,
    version = SCORING_VERSION,
  ): Promise<string> {
    await assertEfaStaff(this.prisma, staff, courseId);
    const salt = researchSalt();
    const pid = (id: string) => researchPseudonym(id, salt);
    switch (kind) {
      case 'occasions':
        return this.occasionsCsv(courseId, pid);
      case 'trials':
        return this.trialsCsv(courseId, pid);
      case 'task-scores':
        return this.scoresCsv(courseId, pid, version);
      case 'questionnaire':
        return this.questionnaireCsv(courseId, pid);
      case 'coding':
        return this.codingCsv(courseId, pid);
    }
  }

  private consented(courseId: string) {
    return { courseId, consentedAt: { not: null } };
  }

  private async occasionsCsv(courseId: string, pid: (id: string) => string) {
    const rows = await this.prisma.efaOccasion.findMany({
      where: this.consented(courseId),
      orderBy: [{ studentId: 'asc' }, { occasion: 'asc' }],
    });
    return toCsv(
      [
        'pid',
        'occasion',
        'status',
        'form',
        'order_code',
        'slot',
        'battery_version',
        'stimuli_sha256',
        'scoring_version',
        'consent_version',
        'consented_at',
        'started_at',
        'questionnaire_done_at',
        'completed_at',
        'abandoned_at',
        'duration_s',
        'fullscreen_accepted',
        'sensing_paused',
        'gap_since_previous_activity_ms',
        'focus_lost_ms_total',
        'device',
        'flags',
      ],
      rows.map((o) => [
        pid(o.studentId),
        o.occasion,
        o.status,
        o.form,
        o.orderCode,
        o.slot,
        o.batteryVersion,
        o.stimuliSha256,
        o.scoringVersion,
        o.consentVersion,
        iso(o.consentedAt),
        iso(o.startedAt),
        iso(o.questionnaireDoneAt),
        iso(o.completedAt),
        iso(o.abandonedAt),
        o.startedAt && o.completedAt
          ? (o.completedAt.getTime() - o.startedAt.getTime()) / 1000
          : '',
        o.fullscreenAccepted,
        o.sensingPaused,
        o.gapSincePreviousActivityMs == null ? '' : String(o.gapSincePreviousActivityMs),
        String(o.focusLostMsTotal),
        o.device,
        o.flags,
      ]),
    );
  }

  private async trialsCsv(courseId: string, pid: (id: string) => string) {
    const runs = await this.prisma.efaTaskRun.findMany({
      where: { occasion: this.consented(courseId) },
      include: {
        occasion: { select: { studentId: true, occasion: true, form: true } },
        trials: { orderBy: [{ phase: 'asc' }, { part: 'asc' }, { trialIndex: 'asc' }] },
      },
      orderBy: [{ occasion: { studentId: 'asc' } }, { taskCode: 'asc' }, { attemptNo: 'asc' }],
    });
    const rows: unknown[][] = [];
    for (const r of runs) {
      for (const t of r.trials) {
        rows.push([
          pid(r.occasion.studentId),
          r.occasion.occasion,
          r.occasion.form,
          r.taskCode,
          r.attemptNo,
          r.status,
          t.phase,
          t.part,
          t.trialIndex,
          t.stimulus,
          t.response,
          t.onsetMs,
          t.firstInputMs,
          t.submitMs,
          t.onsetMs != null && t.submitMs != null
            ? Math.round((t.submitMs - t.onsetMs) * 10) / 10
            : '',
          t.shownMs,
          t.corrections,
          t.focusLostMs,
          t.interrupted,
          t.correct,
        ]);
      }
    }
    return toCsv(
      [
        'pid',
        'occasion',
        'form',
        'task',
        'attempt',
        'run_status',
        'phase',
        'part',
        'trial_index',
        'stimulus',
        'response',
        'onset_ms',
        'first_input_ms',
        'submit_ms',
        'rt_ms',
        'shown_ms',
        'corrections',
        'focus_lost_ms',
        'interrupted',
        'correct',
      ],
      rows,
    );
  }

  /** Long format: one row per measure. */
  private async scoresCsv(courseId: string, pid: (id: string) => string, version: string) {
    const scores = await this.prisma.efaTaskScore.findMany({
      where: { scoringVersion: version, taskRun: { occasion: this.consented(courseId) } },
      include: {
        taskRun: {
          select: {
            taskCode: true,
            attemptNo: true,
            status: true,
            occasion: { select: { studentId: true, occasion: true, form: true, orderCode: true } },
          },
        },
      },
    });
    const rows: unknown[][] = [];
    for (const s of scores) {
      const r = s.taskRun;
      for (const [measure, value] of Object.entries((s.scores as Record<string, unknown>) ?? {})) {
        rows.push([
          pid(r.occasion.studentId),
          r.occasion.occasion,
          r.occasion.form,
          r.occasion.orderCode,
          r.taskCode,
          r.attemptNo,
          r.status,
          s.scoringVersion,
          measure,
          value,
          s.flags,
          iso(s.computedAt),
        ]);
      }
    }
    rows.sort((a, b) => String(a.slice(0, 9)).localeCompare(String(b.slice(0, 9))));
    return toCsv(
      [
        'pid',
        'occasion',
        'form',
        'order_code',
        'task',
        'attempt',
        'run_status',
        'scoring_version',
        'measure',
        'value',
        'flags',
        'computed_at',
      ],
      rows,
    );
  }

  /** Every answer (kind=answer) plus the "How you usually are" sums (kind=score). */
  private async questionnaireCsv(courseId: string, pid: (id: string) => string) {
    const occasions = await this.prisma.efaOccasion.findMany({
      where: this.consented(courseId),
      include: { answers: { orderBy: { itemCode: 'asc' } } },
      orderBy: [{ studentId: 'asc' }, { occasion: 'asc' }],
    });
    const key = (await this.occasions.stimulusSet()).data.adexi.key;
    const rows: unknown[][] = [];
    for (const o of occasions) {
      const p = pid(o.studentId);
      const numeric: Record<string, number> = {};
      for (const a of o.answers) {
        rows.push([p, o.occasion, 'answer', a.itemCode, a.value, iso(a.answeredAt), '']);
        if (typeof a.value === 'number') numeric[a.itemCode] = a.value;
      }
      const adexi = scoreAdexi(numeric, key);
      for (const [k, v] of Object.entries(adexi?.scores ?? {})) {
        rows.push([p, o.occasion, 'score', `adexi_${k}`, v, '', SCORING_VERSION]);
      }
    }
    return toCsv(
      ['pid', 'occasion', 'kind', 'item_code', 'value', 'answered_at', 'scoring_version'],
      rows,
    );
  }

  /** One row per coded entry: both rater codes, agreement and the final code. */
  private async codingCsv(courseId: string, pid: (id: string) => string) {
    const trials = await this.prisma.efaTrial.findMany({
      where: {
        phase: 'test',
        OR: [{ codes: { some: {} } }, { finalCodes: { some: {} } }],
        taskRun: { taskCode: { in: ['w4', 'w5'] }, occasion: this.consented(courseId) },
      },
      include: {
        codes: { orderBy: { createdAt: 'asc' } },
        finalCodes: true,
        taskRun: {
          select: {
            taskCode: true,
            attemptNo: true,
            occasion: { select: { studentId: true, occasion: true } },
          },
        },
      },
    });
    const rows: unknown[][] = [];
    for (const t of trials) {
      const entries =
        t.taskRun.taskCode === 'w4'
          ? ((t.response as { entries?: Array<{ text: string }> })?.entries ?? []).map(
              (e) => e.text,
            )
          : [String((t.response as { raw?: string } | null)?.raw ?? '')];
      entries.forEach((text, i) => {
        const raters = t.codes.filter((c) => c.entryIndex === i);
        const f = t.finalCodes.find((x) => x.entryIndex === i);
        if (!raters.length && !f) return;
        const [a, b] = raters;
        rows.push([
          pid(t.taskRun.occasion.studentId),
          t.taskRun.occasion.occasion,
          t.taskRun.taskCode,
          t.taskRun.attemptNo,
          t.part,
          t.trialIndex,
          i,
          text,
          a ? `r_${pid(a.raterId)}` : '',
          a?.code,
          a?.category,
          b ? `r_${pid(b.raterId)}` : '',
          b?.code,
          b?.category,
          a && b ? a.code === b.code && (a.category ?? null) === (b.category ?? null) : '',
          f?.code,
          f?.category,
          f?.source,
        ]);
      });
    }
    rows.sort((x, y) => String(x.slice(0, 7)).localeCompare(String(y.slice(0, 7))));
    return toCsv(
      [
        'pid',
        'occasion',
        'task',
        'attempt',
        'part',
        'trial_index',
        'entry_index',
        'text',
        'rater_1',
        'code_1',
        'category_1',
        'rater_2',
        'code_2',
        'category_2',
        'agree',
        'final_code',
        'final_category',
        'final_source',
      ],
      rows,
    );
  }
}
