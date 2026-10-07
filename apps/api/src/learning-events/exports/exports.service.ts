import { Injectable, Optional, ServiceUnavailableException } from '@nestjs/common';
import { createHash } from 'crypto';
import { PrismaService } from '../../prisma';
import { LIBRARY_VERSION } from '../engine/params';
import { prepareActions } from '../engine/prepare';
import type { RawAction } from '../engine/types';
import { csvCell } from '../validation/validation.service';
import { TextConsentService } from '../../governance/text-consent.service';

export type EventLogActivity = 'raw' | 'learning_event';
export type EventLogCase = 'item' | 'session';
/** activitylog: one row per instance (start/end); eventlog: start + complete lifecycle rows. */
export type EventLogFormat = 'activitylog' | 'eventlog';

/**
 * Research exports (plan Phase 5.2). Analysis runs in R/Python on these
 * files; there are no in-app process-mining views in v1 (decision #7).
 *
 * Pseudonymisation (plan Phase 6.2 #4, needed here already): every student
 * id is replaced by a salted SHA-256 prefix. The salt comes from
 * RESEARCH_EXPORT_SALT and never appears in an export; without it the
 * exports refuse to run rather than fall back to real ids.
 */
@Injectable()
export class ResearchExportsService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly consent?: TextConsentService,
  ) {}

  /**
   * Phase 6.2 #1(c): research exports include only learners whose latest
   * decision for the course allows research use. (No consent service wired
   * = unit-test context, no filter.)
   */
  private async researchFilter(courseId: string): Promise<(studentId: string) => boolean> {
    if (!this.consent) return () => true;
    const ok = await this.consent.researchConsenting(courseId);
    return (id) => ok.has(id);
  }

  private salt(): string {
    const s = process.env.RESEARCH_EXPORT_SALT;
    if (!s || s.length < 16) {
      throw new ServiceUnavailableException(
        'Research exports need RESEARCH_EXPORT_SALT (≥ 16 characters) in the API environment.',
      );
    }
    return s;
  }

  pseudonym(studentId: string, salt = this.salt()): string {
    return createHash('sha256').update(`${salt}:${studentId}`).digest('hex').slice(0, 16);
  }

  private async courseSessions(courseId: string) {
    const [direct, viaLogs] = await Promise.all([
      this.prisma.studentSession.findMany({ where: { courseId }, select: { id: true } }),
      this.prisma.activityLog.findMany({
        where: { courseId },
        select: { sessionId: true },
        distinct: ['sessionId'],
      }),
    ]);
    return [...new Set([...direct.map((s) => s.id), ...viaLogs.map((s) => s.sessionId)])];
  }

  private async courseActions(courseId: string) {
    const sessionIds = await this.courseSessions(courseId);
    const rows = await this.prisma.activityLog.findMany({
      where: { sessionId: { in: sessionIds } },
      select: {
        id: true,
        sessionId: true,
        userId: true,
        action: true,
        occurredAt: true,
        courseId: true,
        moduleItemId: true,
        interventionId: true,
        metadata: true,
      },
    });
    const allowed = await this.researchFilter(courseId);
    const bySession = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!allowed(r.userId)) continue;
      bySession.set(r.sessionId, [...(bySession.get(r.sessionId) ?? []), r]);
    }
    const out: Array<RawAction & { sessionId: string; userId: string }> = [];
    for (const [sessionId, list] of bySession) {
      const userId = list[0]!.userId;
      const { actions } = prepareActions(
        list.map((r) => ({
          id: r.id,
          action: r.action,
          at: r.occurredAt.getTime(),
          courseId: r.courseId,
          moduleItemId: r.moduleItemId,
          interventionId: r.interventionId,
          meta: (r.metadata ?? {}) as Record<string, unknown>,
        })),
      );
      for (const a of actions) out.push({ ...a, sessionId, userId });
    }
    return out;
  }

  /**
   * Event log for process mining (bupaR / pMineR / PM4Py). One row per
   * activity instance:
   *   case_id, activity, activity_instance, timestamp_start, timestamp_end,
   *   resource, rule_id, outcome, slide_key, library_version, parameter_set_version
   * In R: bupaR::activitylog(df, case_id = "case_id", activity_id = "activity",
   *   resource_id = "resource", timestamps = c("timestamp_start", "timestamp_end"))
   *
   * format 'eventlog' writes the same instances as two rows each (lifecycle
   * start/complete) with a single `timestamp` column, for bupaR::eventlog():
   *   eventlog(df, case_id = "case_id", activity_id = "activity",
   *     activity_instance_id = "activity_instance", lifecycle_id = "lifecycle",
   *     timestamp = "timestamp", resource_id = "resource")
   */
  async eventLogCsv(
    courseId: string,
    activity: EventLogActivity,
    caseBy: EventLogCase,
    format: EventLogFormat = 'activitylog',
  ): Promise<string> {
    const csv = await this.activityLogCsv(courseId, activity, caseBy);
    return format === 'eventlog' ? toLifecycleRows(csv) : csv;
  }

  private async activityLogCsv(
    courseId: string,
    activity: EventLogActivity,
    caseBy: EventLogCase,
  ): Promise<string> {
    const salt = this.salt();
    const header = [
      'case_id',
      'activity',
      'activity_instance',
      'timestamp_start',
      'timestamp_end',
      'resource',
      'rule_id',
      'outcome',
      'slide_key',
      'library_version',
      'parameter_set_version',
    ];
    const lines = [header.join(',')];
    const caseId = (studentId: string, sessionId: string, itemId: string | null) =>
      `${this.pseudonym(studentId, salt)}_${caseBy === 'session' ? sessionId.slice(0, 8) : (itemId ?? 'none').slice(0, 8)}`;
    const iso = (ms: number) => new Date(ms).toISOString();

    if (activity === 'raw') {
      // Course events only: everything the lesson/Prompt Lab logged, plus
      // the chatbot and intervention actions that sit beside the lesson.
      const actions = (await this.courseActions(courseId)).filter(
        (a) => a.meta.libraryVersion != null || /^(CHATBOT_MESSAGE_|INTERVENTION_)/.test(a.action),
      );
      actions.sort((a, b) => a.at - b.at);
      for (const a of actions) {
        const dwell = a.action === 'SLIDE_EXITED' ? Number(a.meta.dwellMs) || 0 : 0;
        lines.push(
          [
            caseId(a.userId, a.sessionId, a.moduleItemId),
            a.action,
            a.id,
            iso(a.at - dwell),
            iso(a.at),
            this.pseudonym(a.userId, salt),
            '',
            '',
            a.meta.slideKey ?? '',
            a.meta.libraryVersion ?? '',
            '',
          ]
            .map(csvCell)
            .join(','),
        );
      }
    } else {
      const sessionIds = await this.courseSessions(courseId);
      const events = await this.prisma.learningEvent.findMany({
        where: { sessionId: { in: sessionIds } },
        orderBy: { startAt: 'asc' },
      });
      const allowed = await this.researchFilter(courseId);
      for (const e of events.filter((x) => allowed(x.studentId))) {
        lines.push(
          [
            caseId(e.studentId, e.sessionId, e.moduleItemId),
            e.eventFamily,
            e.id,
            e.startAt.toISOString(),
            e.endAt.toISOString(),
            this.pseudonym(e.studentId, salt),
            e.ruleId,
            e.outcome ?? '',
            e.slideKey ?? '',
            e.libraryVersion,
            e.parameterSetVersion,
          ]
            .map(csvCell)
            .join(','),
        );
      }
    }
    return lines.join('\n') + '\n';
  }

  /**
   * One row per student (plan Phase 5.2 #2): the outcomes any process
   * indicator is judged against. Transfer score = mean of scored transfer
   * tasks as a share of the rubric maximum; delayed test is not in the
   * course yet (column kept, empty).
   */
  async outcomesCsv(courseId: string): Promise<string> {
    const salt = this.salt();
    const actions = await this.courseActions(courseId);
    const items = await this.prisma.moduleItem.findMany({
      where: { module: { courseId }, type: 'INTERACTIVE_LESSON' },
      select: { id: true },
    });
    const transfer = await this.prisma.transferTaskScore.findMany({
      where: { moduleItemId: { in: items.map((i) => i.id) } },
    });
    const [runs, versions] = await Promise.all([
      this.prisma.promptLabRun.groupBy({
        by: ['studentId'],
        where: { courseId },
        _count: { _all: true },
      }),
      this.prisma.promptLabVersion.groupBy({
        by: ['studentId'],
        where: { moduleItemId: { in: items.map((i) => i.id) } },
        _count: { _all: true },
      }),
    ]);

    const allowed = await this.researchFilter(courseId);
    const students = [
      ...new Set([...actions.map((a) => a.userId), ...transfer.map((t) => t.studentId)]),
    ].filter(allowed);
    const mean = (xs: number[]) => (xs.length ? xs.reduce((s, x) => s + x, 0) / xs.length : null);
    const round = (v: number | null) => (v == null ? '' : (Math.round(v * 1000) / 1000).toString());

    const header = [
      'student',
      'sessions',
      'mcq_answered',
      'mcq_accuracy',
      'confidence_pairs',
      'calibration_bias',
      'calibration_absolute',
      'self_score_mean_0_2',
      'self_score_criteria',
      'transfer_tasks_scored',
      'transfer_score_share',
      'delayed_test_score',
      'prompt_runs',
      'prompt_versions',
      'library_version',
    ];
    const lines = [header.join(',')];
    for (const sid of students) {
      const mine = actions.filter((a) => a.userId === sid);
      const mcq = mine.filter((a) => a.action === 'MCQ_ANSWERED');
      // calibration: last 'before' confidence on the same slide preceding the answer
      const pairs: Array<{ p: number; c: number }> = [];
      for (const ans of mcq) {
        const conf = mine
          .filter(
            (a) =>
              a.action === 'CONFIDENCE_RATED' &&
              a.meta.timing === 'before' &&
              a.meta.slideKey === ans.meta.slideKey &&
              a.moduleItemId === ans.moduleItemId &&
              a.at <= ans.at,
          )
          .pop();
        if (conf)
          pairs.push({
            p: (Number(conf.meta.value) - 1) / 4,
            c: ans.meta.correct === true ? 1 : 0,
          });
      }
      // self-scores: the latest value per criterion and slide
      const latest = new Map<string, number>();
      for (const a of mine.filter((x) => x.action === 'CRITERION_SELF_SCORED')) {
        latest.set(
          `${a.moduleItemId}|${a.meta.slideKey}|${a.meta.criterion}`,
          Number(a.meta.value),
        );
      }
      const t = transfer.filter((x) => x.studentId === sid && x.maxTotal > 0);
      lines.push(
        [
          this.pseudonym(sid, salt),
          new Set(mine.map((a) => a.sessionId)).size,
          mcq.length,
          round(mean(mcq.map((a) => (a.meta.correct === true ? 1 : 0)))),
          pairs.length,
          round(pairs.length ? mean(pairs.map((x) => x.p))! - mean(pairs.map((x) => x.c))! : null),
          round(mean(pairs.map((x) => Math.abs(x.p - x.c)))),
          round(mean([...latest.values()])),
          latest.size,
          t.length,
          round(mean(t.map((x) => x.total / x.maxTotal))),
          '',
          runs.find((r) => r.studentId === sid)?._count._all ?? 0,
          versions.find((v) => v.studentId === sid)?._count._all ?? 0,
          LIBRARY_VERSION,
        ]
          .map(csvCell)
          .join(','),
      );
    }
    return lines.join('\n') + '\n';
  }
}

/** Minimal CSV line splitter for rows this service wrote (csvCell quoting). */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cur += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      out.push(cur);
      cur = '';
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

/**
 * Activity-log CSV → event-log CSV: each instance becomes a `start` and a
 * `complete` row (bupaR's standard lifecycle), ordered by timestamp.
 */
export function toLifecycleRows(activityCsv: string): string {
  const [headLine, ...body] = activityCsv.trimEnd().split('\n');
  const head = splitCsvLine(headLine!);
  const iStart = head.indexOf('timestamp_start');
  const iEnd = head.indexOf('timestamp_end');
  const rest = head.filter((_, i) => i !== iStart && i !== iEnd);
  const outHead = [...rest.slice(0, 3), 'lifecycle', 'timestamp', ...rest.slice(3)];
  const rows: Array<{ ts: string; order: number; cells: string[] }> = [];
  for (const line of body) {
    if (!line) continue;
    const cells = splitCsvLine(line);
    const keep = cells.filter((_, i) => i !== iStart && i !== iEnd);
    const mk = (lifecycle: string, ts: string, order: number) => ({
      ts,
      order,
      cells: [...keep.slice(0, 3), lifecycle, ts, ...keep.slice(3)],
    });
    rows.push(mk('start', cells[iStart]!, 0), mk('complete', cells[iEnd]!, 1));
  }
  rows.sort((a, b) => (a.ts < b.ts ? -1 : a.ts > b.ts ? 1 : a.order - b.order));
  return (
    [outHead, ...rows.map((r) => r.cells)].map((c) => c.map(csvCell).join(',')).join('\n') + '\n'
  );
}
