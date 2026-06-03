import type { FastifyInstance } from 'fastify';
import { computePdt, type SnapshotAoiState, type Aoi } from '@gals-studio/shared';
import { prisma } from '../prisma.js';

const parse = <T>(v: string | null, fallback: T): T => {
  if (v == null) return fallback;
  try {
    return JSON.parse(v) as T;
  } catch {
    return fallback;
  }
};

/** Bucket-average decimation: never hand the client more than maxPoints. */
function decimate(points: { t: number; v: number }[], maxPoints: number): { t: number; v: number }[] {
  if (points.length <= maxPoints) return points;
  const bucket = points.length / maxPoints;
  const out: { t: number; v: number }[] = [];
  for (let b = 0; b < maxPoints; b++) {
    const start = Math.floor(b * bucket);
    const end = Math.floor((b + 1) * bucket);
    let st = 0;
    let sv = 0;
    let nn = 0;
    for (let i = start; i < end && i < points.length; i++) {
      st += points[i].t;
      sv += points[i].v;
      nn += 1;
    }
    if (nn) out.push({ t: st / nn, v: sv / nn });
  }
  return out;
}

const EMOTIONS = ['pHappiness', 'pSadness', 'pSurprise', 'pFear', 'pAnger', 'pDisgust', 'pContempt', 'pNeutral'] as const;

export async function replayRoutes(app: FastifyInstance): Promise<void> {
  app.get<{ Params: { sessionId: string } }>('/api/replay/:sessionId/meta', async (req, reply) => {
    const { sessionId } = req.params;
    const session = await prisma.session.findUnique({ where: { id: sessionId } });
    if (!session) return reply.code(404).send({ error: 'session not found' });
    const [snapshots, gaze, emotion, au, pupil, clicks, webcam, messages, ef, interventions] = await Promise.all([
      prisma.snapshot.count({ where: { sessionId } }),
      prisma.gazeSample.count({ where: { sessionId } }),
      prisma.emotionFrame.count({ where: { sessionId } }),
      prisma.auResult.count({ where: { sessionId } }),
      prisma.pupilSample.count({ where: { sessionId } }),
      prisma.click.count({ where: { sessionId } }),
      prisma.webcamSegment.count({ where: { sessionId, status: 'ok' } }),
      prisma.chatbotMessage.count({ where: { sessionId } }),
      prisma.efDetection.count({ where: { sessionId } }),
      prisma.intervention.count({ where: { sessionId } }),
    ]);
    const sample = await prisma.snapshot.findMany({ where: { sessionId }, take: 50, select: { aois: true } });
    const regions = new Set<string>();
    for (const s of sample) for (const a of parse<Aoi[]>(s.aois, [])) regions.add(a.region);
    return {
      session: {
        id: session.id,
        userId: session.userId,
        userDisplayName: session.userDisplayName,
        courseId: session.courseId,
        courseTitle: session.courseTitle,
        startedAt: session.startedAt.toISOString(),
        timezone: session.timezone,
      },
      durationMs: session.durationMs,
      baseWallClockMs: session.baseWallClockMs,
      counts: { snapshots, gaze, emotion, au, pupil, clicks, webcam, messages, ef, interventions },
      aoiRegions: [...regions].sort(),
      hasWebcam: webcam > 0,
    };
  });

  app.get<{ Params: { sessionId: string }; Querystring: { signals?: string; from?: string; to?: string; maxPoints?: string } }>(
    '/api/replay/:sessionId/streams',
    async (req, reply) => {
      const { sessionId } = req.params;
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session) return reply.code(404).send({ error: 'session not found' });
      const base = session.baseWallClockMs;
      const maxPoints = Math.min(Number(req.query.maxPoints ?? 2000), 5000);
      const from = req.query.from != null ? Number(req.query.from) + base : undefined;
      const to = req.query.to != null ? Number(req.query.to) + base : undefined;
      const wallFilter = from != null || to != null ? { gte: from, lte: to } : undefined;
      const requested = (req.query.signals ?? 'emotions,aus,pupil').split(',');

      const result: Record<string, unknown> = {};

      if (requested.includes('emotions')) {
        const frames = await prisma.emotionFrame.findMany({
          where: { sessionId, ...(wallFilter ? { wallMs: wallFilter } : {}) },
          orderBy: { wallMs: 'asc' },
        });
        const emo: Record<string, { t: number; v: number }[]> = {};
        for (const key of EMOTIONS) emo[key] = [];
        for (const f of frames) {
          const t = f.wallMs - base;
          for (const key of EMOTIONS) {
            const v = (f as Record<string, unknown>)[key];
            if (typeof v === 'number') emo[key].push({ t, v });
          }
        }
        result.emotions = Object.fromEntries(
          Object.entries(emo).map(([k, pts]) => [k.replace(/^p/, '').toLowerCase(), decimate(pts, maxPoints)]),
        );
      }

      if (requested.includes('aus')) {
        const rows = await prisma.auResult.findMany({
          where: { sessionId, ...(wallFilter ? { wallMs: wallFilter } : {}) },
          orderBy: { wallMs: 'asc' },
        });
        const auSeries: Record<string, { t: number; v: number }[]> = {};
        for (const r of rows) {
          const t = r.wallMs - base;
          const aus = parse<Record<string, number>>(r.aus, {});
          for (const [k, v] of Object.entries(aus)) (auSeries[k] ??= []).push({ t, v });
        }
        result.aus = Object.fromEntries(Object.entries(auSeries).map(([k, pts]) => [k, decimate(pts, maxPoints)]));
      }

      if (requested.includes('pupil')) {
        const rows = await prisma.pupilSample.findMany({
          where: { sessionId, ...(wallFilter ? { wallMs: wallFilter } : {}) },
          orderBy: { wallMs: 'asc' },
        });
        result.pupil = decimate(rows.map((r) => ({ t: r.wallMs - base, v: r.diameter })), maxPoints);
      }

      return result;
    },
  );

  app.get<{ Params: { sessionId: string } }>('/api/replay/:sessionId/snapshots/index', async (req) => {
    const { sessionId } = req.params;
    const rows = await prisma.snapshot.findMany({
      where: { sessionId },
      orderBy: { wallMs: 'asc' },
      select: { id: true, wallMs: true, trigger: true, pageUrl: true, width: true, height: true, pdfCurrentPage: true, pdfTotalPages: true, aois: true, scrollHosts: true, screenshotPath: true },
    });
    return {
      snapshots: rows.map((r) => ({
        id: r.id,
        wallMs: r.wallMs,
        trigger: r.trigger,
        pageUrl: r.pageUrl,
        width: r.width,
        height: r.height,
        pdfCurrentPage: r.pdfCurrentPage,
        pdfTotalPages: r.pdfTotalPages,
        aois: parse<Aoi[]>(r.aois, []),
        scrollHosts: parse<unknown[]>(r.scrollHosts, []),
        hasScreenshot: !!r.screenshotPath,
      })),
    };
  });

  app.get<{ Params: { sessionId: string; snapshotId: string } }>(
    '/api/replay/:sessionId/snapshots/:snapshotId',
    async (req, reply) => {
      const { sessionId, snapshotId } = req.params;
      const snap = await prisma.snapshot.findFirst({ where: { id: snapshotId, sessionId } });
      if (!snap) return reply.code(404).send({ error: 'snapshot not found' });
      return {
        id: snap.id,
        wallMs: snap.wallMs,
        htmlUrl: `/api/media/snapshot/${sessionId}/${snapshotId}.html`,
        screenshotUrl: snap.screenshotPath ? `/api/media/snapshot/${sessionId}/${snapshotId}.jpg` : null,
        width: snap.width,
        height: snap.height,
        aois: parse<Aoi[]>(snap.aois, []),
        scrollHosts: parse<unknown[]>(snap.scrollHosts, []),
        pdfCurrentPage: snap.pdfCurrentPage,
        pdfTotalPages: snap.pdfTotalPages,
      };
    },
  );

  app.get<{ Params: { sessionId: string } }>('/api/replay/:sessionId/sparse', async (req) => {
    const { sessionId } = req.params;
    const [clicks, chatbot, dialogue, interventions, ef, visibility, probes, webcam, gaze] = await Promise.all([
      prisma.click.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
      prisma.chatbotMessage.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
      prisma.dialogueMessage.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
      prisma.intervention.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
      prisma.efDetection.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
      prisma.visibility.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
      prisma.probeResponse.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
      prisma.webcamSegment.findMany({ where: { sessionId }, orderBy: { startWallMs: 'asc' } }),
      prisma.gazeSample.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
    ]);
    return {
      clicks: clicks.map((c) => ({ wallMs: c.wallMs, x: c.x, y: c.y, target: c.target })),
      chatbot: chatbot.map((m) => ({ wallMs: m.wallMs, role: m.role, content: m.content })),
      dialogue: dialogue.map((m) => ({ wallMs: m.wallMs, role: m.role, content: m.content })),
      interventions: interventions.map((iv) => ({ wallMs: iv.wallMs, type: iv.type, status: iv.status })),
      efDetections: ef.map((d) => ({ wallMs: d.wallMs, construct: d.construct, label: d.label, severity: d.severity, confidence: d.confidence })),
      visibility: visibility.map((v) => ({ wallMs: v.wallMs, visibleState: v.visibleState, hiddenDurationMs: v.hiddenDurationMs })),
      probes: probes.map((p) => ({ wallMs: p.wallMs, probeType: p.probeType, shownWallMs: p.shownWallMs })),
      webcam: webcam.map((w) => ({
        segmentId: w.id,
        startWallMs: w.startWallMs,
        endWallMs: w.endWallMs,
        status: w.status,
        url: w.mp4Path ? `/api/media/webcam/${sessionId}/${w.mp4Path.split(/[\\/]/).pop()}` : null,
      })),
      gaze: gaze.map((g) => ({ wallMs: g.wallMs, x: g.x, y: g.y, confidence: g.confidence })),
    };
  });

  app.get<{ Params: { sessionId: string } }>('/api/replay/:sessionId/coverage', async (req) => {
    const { sessionId } = req.params;
    const [gaze, snaps] = await Promise.all([
      prisma.gazeSample.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' }, select: { wallMs: true, x: true, y: true, confidence: true } }),
      prisma.snapshot.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' }, select: { wallMs: true, aois: true } }),
    ]);
    const snapshots: SnapshotAoiState[] = snaps.map((s) => ({ wallMs: s.wallMs, aois: parse<Aoi[]>(s.aois, []) }));
    return computePdt(gaze, snapshots);
  });
}
