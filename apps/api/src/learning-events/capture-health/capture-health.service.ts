import { Injectable, NotFoundException } from '@nestjs/common';
import { ACTION_CATALOGUE, checkMetadata, type ActionSpec } from '@ats/shared';
import { PrismaService } from '../../prisma';

/**
 * Capture health (Prompt B, P6 / B8): how complete and trustworthy one
 * session's data is, and the same summed over a course. Everything here is
 * read from what P1 to P5 record:
 *   - actions per type, and the rate of rows missing a required metadata
 *     key or with the wrong type (catalogue schemas, checkMetadata)
 *   - sequence gaps and out-of-order arrivals (capture_quality)
 *   - data refused, duplicated or dropped on the way in (ingest_issues)
 *   - how the session ended, whether and when it was parsed (parse runs)
 *   - clock offset, sensing-channel coverage, rule coverage of active time
 *   - catalogue actions expected on the surfaces visited but never seen
 */
const catalogue = ACTION_CATALOGUE as Record<string, ActionSpec>;

/** Rows checked per action for the missing-field rate (enough for a rate). */
const SCHEMA_SAMPLE = 500;

export interface SessionHealth {
  session: {
    id: string;
    userId: string;
    courseId: string | null;
    startedAt: string;
    endedAt: string | null;
    closeReason: string | null;
    paramsVersion: string | null;
    clockOffsetMs: number | null;
    episodeKey: string | null;
    previousSessionId: string | null;
  };
  actions: Array<{
    action: string;
    count: number;
    checked: number;
    invalid: number;
    invalidRate: number;
    issues: string[];
  }>;
  quality: {
    gaps: number;
    missingEvents: number;
    outOfOrder: number;
    byStream: Record<string, { gaps: number; missing: number }>;
  };
  ingest: Array<{ stream: string; kind: string; reason: string; events: number }>;
  parse: {
    parsed: boolean;
    runs: number;
    lastStatus: string | null;
    lastFinishedAt: string | null;
    detections: number | null;
  };
  coverage: {
    activeMs: number;
    explainedMs: number;
    explainedShare: number | null;
    noPatternSpans: number;
    unresolved: number;
  } | null;
  sensing: Record<string, number>;
  unobserved: string[];
  score: { ok: boolean; problems: string[] };
}

@Injectable()
export class CaptureHealthService {
  constructor(private readonly prisma: PrismaService) {}

  async session(sessionId: string): Promise<SessionHealth> {
    const s = await this.prisma.studentSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new NotFoundException(`Session ${sessionId} not found`);

    const counts = await this.prisma.activityLog.groupBy({
      by: ['action'],
      where: { sessionId },
      _count: { _all: true },
    });
    const actions: SessionHealth['actions'] = [];
    for (const c of counts) {
      const action = String(c.action);
      const rows = await this.prisma.activityLog.findMany({
        where: { sessionId, action: c.action },
        select: { metadata: true },
        take: SCHEMA_SAMPLE,
      });
      const issues = new Map<string, number>();
      let invalid = 0;
      for (const r of rows) {
        const errs = checkMetadata(action, r.metadata) ?? ['(not in catalogue)'];
        if (errs.length) {
          invalid++;
          for (const e of errs) issues.set(e, (issues.get(e) ?? 0) + 1);
        }
      }
      actions.push({
        action,
        count: c._count._all,
        checked: rows.length,
        invalid,
        invalidRate: rows.length ? round(invalid / rows.length) : 0,
        issues: [...issues]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([k, n]) => `${k} (${n})`),
      });
    }
    actions.sort((a, b) => b.count - a.count);

    const q = await this.prisma.captureQuality.findMany({ where: { sessionId } });
    const byStream: Record<string, { gaps: number; missing: number }> = {};
    let gaps = 0;
    let missing = 0;
    let outOfOrder = 0;
    for (const r of q) {
      if (r.kind === 'gap') {
        gaps++;
        missing += r.count;
        const b = (byStream[r.stream] ??= { gaps: 0, missing: 0 });
        b.gaps++;
        b.missing += r.count;
      } else if (r.kind === 'out_of_order') outOfOrder += r.count;
    }

    const issues = await this.prisma.ingestIssue.groupBy({
      by: ['stream', 'kind', 'reason'],
      where: { sessionId },
      _sum: { eventCount: true },
    });

    const runs = await this.prisma.sessionParseRun.findMany({
      where: { sessionId },
      orderBy: { startedAt: 'desc' },
    });
    const okRun = runs.find((r) => r.status === 'ok');
    const cov = await this.prisma.learningEventCoverage.findFirst({
      where: { sessionId, isCurrent: true },
    });

    const sid = sessionId;
    const [snapshots, webcam, gaze, pupil, cursor, clicks, keys, scroll, visibility, clipboard] =
      await Promise.all([
        this.prisma.sessionReplaySnapshot.count({ where: { sessionId: sid } }),
        this.prisma.recordingSegment.count({ where: { sessionId: sid } }),
        this.prisma.webgazerLog.count({ where: { sessionId: sid } }),
        this.prisma.pupilSizeLog.count({ where: { sessionId: sid } }),
        this.prisma.cursor_logs.count({ where: { sessionId: sid } }),
        this.prisma.click_logs.count({ where: { sessionId: sid } }),
        this.prisma.keystroke_logs.count({ where: { sessionId: sid } }),
        this.prisma.scroll_logs.count({ where: { sessionId: sid } }),
        this.prisma.visibility_logs.count({ where: { sessionId: sid } }),
        this.prisma.clipboard_logs.count({ where: { sessionId: sid } }),
      ]);
    const sensing = {
      replaySnapshots: snapshots,
      webcamSegments: webcam,
      gazeRows: gaze,
      pupilRows: pupil,
      cursor,
      clicks,
      keystrokeBursts: keys,
      scroll,
      visibility,
      clipboard,
    };

    // Expected but never seen: live client actions of the surfaces this
    // session touched (surface = the catalogue's surface label).
    const seen = new Set(actions.map((a) => a.action));
    const surfaces = new Set([...seen].map((a) => catalogue[a]?.surface).filter(Boolean));
    const unobserved = Object.entries(catalogue)
      .filter(
        ([a, spec]) =>
          !spec.deprecated && spec.side !== 'server' && surfaces.has(spec.surface) && !seen.has(a),
      )
      .map(([a]) => a)
      .sort();

    const problems: string[] = [];
    if (missing > 0) problems.push(`${missing} event(s) missing (sequence gaps)`);
    const refused = issues
      .filter((i) => i.kind !== 'duplicate')
      .reduce((n, i) => n + (i._sum.eventCount ?? 0), 0);
    if (refused > 0) problems.push(`${refused} event(s) refused, dropped or overflowed`);
    if (s.endedAt && !okRun) problems.push('closed but never parsed');
    if (!s.endedAt) problems.push('still open');
    const badSchema = actions.filter((a) => a.invalidRate > 0.1);
    if (badSchema.length)
      problems.push(`${badSchema.length} action type(s) with >10% rows missing required fields`);

    return {
      session: {
        id: s.id,
        userId: s.userId,
        courseId: s.courseId,
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt?.toISOString() ?? null,
        closeReason: s.closeReason,
        paramsVersion: s.paramsVersion,
        clockOffsetMs: s.clockOffsetMs,
        episodeKey: s.episodeKey,
        previousSessionId: s.previousSessionId,
      },
      actions,
      quality: { gaps, missingEvents: missing, outOfOrder, byStream },
      ingest: issues.map((i) => ({
        stream: i.stream,
        kind: i.kind,
        reason: i.reason,
        events: i._sum.eventCount ?? 0,
      })),
      parse: {
        parsed: !!okRun,
        runs: runs.length,
        lastStatus: runs[0]?.status ?? null,
        lastFinishedAt: okRun?.finishedAt?.toISOString() ?? null,
        detections: okRun?.detections ?? null,
      },
      coverage: cov
        ? {
            activeMs: cov.activeMs,
            explainedMs: cov.explainedMs,
            explainedShare: cov.activeMs ? round(cov.explainedMs / cov.activeMs) : null,
            noPatternSpans: cov.noPatternSpans,
            unresolved: cov.unresolved,
          }
        : null,
      sensing,
      unobserved,
      score: { ok: problems.length === 0, problems },
    };
  }

  /** One row per session of the course (newest first). */
  async course(courseId: string, limit = 500) {
    const sessions = await this.prisma.studentSession.findMany({
      where: { courseId },
      orderBy: { startedAt: 'desc' },
      take: limit,
      select: { id: true },
    });
    const rows = [];
    for (const { id } of sessions) {
      const h = await this.session(id);
      rows.push({
        sessionId: id,
        userId: h.session.userId,
        startedAt: h.session.startedAt,
        endedAt: h.session.endedAt,
        closeReason: h.session.closeReason,
        events: h.actions.reduce((n, a) => n + a.count, 0),
        missingEvents: h.quality.missingEvents,
        outOfOrder: h.quality.outOfOrder,
        refused: h.ingest.filter((i) => i.kind !== 'duplicate').reduce((n, i) => n + i.events, 0),
        duplicates: h.ingest
          .filter((i) => i.kind === 'duplicate')
          .reduce((n, i) => n + i.events, 0),
        parsed: h.parse.parsed,
        detections: h.parse.detections,
        explainedShare: h.coverage?.explainedShare ?? null,
        clockOffsetMs: h.session.clockOffsetMs,
        replaySnapshots: h.sensing.replaySnapshots,
        webcamSegments: h.sensing.webcamSegments,
        ok: h.score.ok,
        problems: h.score.problems.join('; '),
      });
    }
    const n = rows.length;
    return {
      courseId,
      sessions: n,
      summary: {
        ok: rows.filter((r) => r.ok).length,
        parsed: rows.filter((r) => r.parsed).length,
        withGaps: rows.filter((r) => r.missingEvents > 0).length,
        missingEvents: rows.reduce((t, r) => t + r.missingEvents, 0),
        refused: rows.reduce((t, r) => t + r.refused, 0),
        closeReasons: rows.reduce<Record<string, number>>((acc, r) => {
          const k = r.closeReason ?? (r.endedAt ? 'unknown' : 'open');
          acc[k] = (acc[k] ?? 0) + 1;
          return acc;
        }, {}),
      },
      rows,
    };
  }

  async courseCsv(courseId: string): Promise<string> {
    const { rows } = await this.course(courseId);
    const cols = rows.length ? Object.keys(rows[0]!) : ['sessionId'];
    const cell = (v: unknown) => {
      const t = v == null ? '' : String(v);
      return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
    };
    return (
      [
        cols.join(','),
        ...rows.map((r) => cols.map((c) => cell((r as Record<string, unknown>)[c])).join(',')),
      ].join('\n') + '\n'
    );
  }
}

function round(x: number): number {
  return Math.round(x * 1000) / 1000;
}
