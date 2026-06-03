/**
 * Research-grade CSV/JSON exports. Long-format opens cleanly in R/pandas and
 * round-trips coded labels. All numbers come from the pure shared functions
 * via compute.ts so they're reproducible.
 */
import { prisma } from '../prisma.js';
import { computeAttention, computeReading, computeDynamics, computeReliability } from './compute.js';

function csv(rows: Record<string, unknown>[]): string {
  if (rows.length === 0) return '';
  const cols = Array.from(rows.reduce((s, r) => { Object.keys(r).forEach((k) => s.add(k)); return s; }, new Set<string>()));
  const esc = (v: unknown) => {
    if (v == null) return '';
    const str = typeof v === 'object' ? JSON.stringify(v) : String(v);
    return /[",\n]/.test(str) ? `"${str.replace(/"/g, '""')}"` : str;
  };
  return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
}

async function scopeSessions(scope: string): Promise<string[]> {
  if (scope === 'all') return (await prisma.session.findMany({ select: { id: true } })).map((s) => s.id);
  return [scope];
}

/** One row per (session, window, dimension, codingPass, coder) + window signal summary. */
export async function longFormatCsv(scope: string): Promise<string> {
  const rows: Record<string, unknown>[] = [];
  for (const sessionId of await scopeSessions(scope)) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) continue;
    const windows = await prisma.codingWindow.findMany({ where: { sessionId }, orderBy: { index: 'asc' } });
    const anns = await prisma.annotation.findMany({ where: { sessionId, windowId: { not: null } } });
    const [emotions, pupil, attention] = await Promise.all([
      prisma.emotionFrame.findMany({ where: { sessionId }, select: { wallMs: true, dominant: true, dominantProbability: true } }),
      prisma.pupilSample.findMany({ where: { sessionId }, select: { wallMs: true, diameter: true } }),
      computeAttention(sessionId).catch(() => null),
    ]);
    const winById = new Map(windows.map((w) => [w.id, w]));
    const epochFor = (wallMs: number) =>
      attention?.epochs.find((e) => wallMs >= e.startWallMs && wallMs < e.endWallMs) ?? null;

    const summarize = (w: { startWallMs: number; endWallMs: number }) => {
      const em = emotions.filter((e) => e.wallMs >= w.startWallMs && e.wallMs < w.endWallMs);
      const pu = pupil.filter((p) => p.wallMs >= w.startWallMs && p.wallMs < w.endWallMs);
      const domCount: Record<string, number> = {};
      for (const e of em) if (e.dominant) domCount[e.dominant] = (domCount[e.dominant] ?? 0) + 1;
      const dominantEmotion = Object.entries(domCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '';
      const ep = epochFor((w.startWallMs + w.endWallMs) / 2);
      return {
        meanPupil: pu.length ? pu.reduce((s, p) => s + p.diameter, 0) / pu.length : '',
        dominantEmotion,
        epochType: ep?.type ?? '',
        allocationScore: ep?.allocationScore ?? '',
      };
    };

    for (const a of anns) {
      const w = winById.get(a.windowId!);
      if (!w) continue;
      const s = summarize(w);
      rows.push({
        sessionId,
        userId: session.userId,
        windowId: a.windowId,
        windowIndex: w.index,
        startWallMs: w.startWallMs,
        endWallMs: w.endWallMs,
        relativeStartS: ((w.startWallMs - session.baseWallClockMs) / 1000).toFixed(1),
        dimension: a.dimension,
        codingPass: a.codingPass,
        coderId: a.coderId,
        code: a.code,
        intensity: a.intensity ?? '',
        confidence: a.confidence ?? '',
        codingMs: a.codingMs ?? '',
        meanPupil: s.meanPupil,
        dominantEmotion: s.dominantEmotion,
        epochType: s.epochType,
        allocationScore: s.allocationScore,
      });
    }
  }
  return csv(rows);
}

/** One row per window with the consensus affect/behavior. */
export async function goldLabelsCsv(scope: string): Promise<string> {
  const rows: Record<string, unknown>[] = [];
  for (const sessionId of await scopeSessions(scope)) {
    const windows = await prisma.codingWindow.findMany({ where: { sessionId }, orderBy: { index: 'asc' } });
    const gold = await prisma.annotation.findMany({ where: { sessionId, codingPass: 'gold_consensus', windowId: { not: null } } });
    const byWin = new Map<string, Record<string, string>>();
    for (const g of gold) {
      byWin.set(g.windowId!, byWin.get(g.windowId!) ?? {});
      byWin.get(g.windowId!)![g.dimension] = g.code;
    }
    for (const w of windows) {
      const codes = byWin.get(w.id) ?? {};
      rows.push({ sessionId, windowIndex: w.index, startWallMs: w.startWallMs, endWallMs: w.endWallMs, affect: codes.affect ?? '', behavior: codes.behavior ?? '' });
    }
  }
  return csv(rows);
}

export async function reliabilityCsv(): Promise<string> {
  const runs = await prisma.reliabilityRun.findMany({ orderBy: { computedAt: 'desc' } });
  return csv(runs.map((r) => ({
    id: r.id, scope: r.scope, dimension: r.dimension, computedAt: r.computedAt.toISOString(),
    metrics: r.metrics, params: r.params,
  })));
}

/** Session-level summary: durations, prevalences, dwell, PDT, allocation, reading. */
export async function sessionSummaryCsv(scope: string): Promise<string> {
  const rows: Record<string, unknown>[] = [];
  for (const sessionId of await scopeSessions(scope)) {
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) continue;
    const [dyn, att, read] = await Promise.all([
      computeDynamics(sessionId).catch(() => null),
      computeAttention(sessionId).catch(() => null),
      computeReading(sessionId).catch(() => null),
    ]);
    rows.push({
      sessionId,
      userId: session.userId,
      durationMs: session.durationMs,
      prevalence: dyn ? JSON.stringify(dyn.prevalence.proportions) : '',
      unresolvedCascades: dyn?.unresolved.length ?? '',
      pdt: att ? JSON.stringify(att.pdt) : '',
      sessionAllocation: att?.sessionAllocation ?? '',
      reading: read ? JSON.stringify(read.items.map((i) => ({ url: i.pageUrl, pctRead: i.pctRead }))) : '',
      windowScrollOnly: read?.windowScrollOnly ?? '',
    });
  }
  return csv(rows);
}

export async function probesCsv(scope: string): Promise<string> {
  const rows: Record<string, unknown>[] = [];
  for (const sessionId of await scopeSessions(scope)) {
    const probes = await prisma.probeResponse.findMany({ where: { sessionId } });
    for (const p of probes) rows.push({ sessionId, wallMs: p.wallMs, probeType: p.probeType, items: p.items, latencyMs: p.latencyMs ?? '', shownWallMs: p.shownWallMs ?? '' });
  }
  return csv(rows);
}

export async function questionnairesCsv(scope: string): Promise<string> {
  const rows: Record<string, unknown>[] = [];
  for (const sessionId of await scopeSessions(scope)) {
    const qs = await prisma.questionnaire.findMany({ where: { sessionId } });
    for (const q of qs) rows.push({ sessionId, instrument: q.instrument, phase: q.phase, items: q.items, scoredSubscales: q.scoredSubscales ?? '' });
  }
  return csv(rows);
}

export const EXPORTERS: Record<string, (scope: string) => Promise<string>> = {
  long: longFormatCsv,
  gold: goldLabelsCsv,
  reliability: () => reliabilityCsv(),
  summary: sessionSummaryCsv,
  probes: probesCsv,
  questionnaires: questionnairesCsv,
};
