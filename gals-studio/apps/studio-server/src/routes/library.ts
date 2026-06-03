import type { FastifyInstance } from 'fastify';
import { rm } from 'node:fs/promises';
import { prisma } from '../prisma.js';
import { mediaDirFor } from '../config.js';

export interface SessionListItem {
  id: string;
  userId: string;
  userDisplayName: string | null;
  courseId: string;
  courseTitle: string | null;
  startedAt: string;
  durationMs: number;
  hasWebcam: boolean;
  counts: {
    snapshots: number;
    gaze: number;
    emotion: number;
    webcamSegments: number;
    messages: number;
  };
  coding: {
    windows: number;
    pctRater1: number;
    pctRater2: number;
    disagreementsPending: number;
  };
}

/** Coding status for one session, readable even before the coding UI ships. */
async function codingStatus(sessionId: string) {
  const windows = await prisma.codingWindow.count({ where: { sessionId } });
  const codedWindows = async (pass: string) => {
    const rows = await prisma.annotation.findMany({
      where: { sessionId, codingPass: pass, dimension: 'affect', windowId: { not: null } },
      select: { windowId: true },
      distinct: ['windowId'],
    });
    return rows.length;
  };
  const r1 = await codedWindows('primary_rater_1');
  const r2 = await codedWindows('primary_rater_2');

  // disagreements: windows where r1 & r2 affect or behavior differ
  const anns = await prisma.annotation.findMany({
    where: {
      sessionId,
      codingPass: { in: ['primary_rater_1', 'primary_rater_2', 'tiebreaker'] },
      dimension: { in: ['affect', 'behavior'] },
      windowId: { not: null },
    },
    select: { windowId: true, codingPass: true, dimension: true, code: true },
  });
  const byWin = new Map<string, Record<string, Record<string, string>>>();
  for (const a of anns) {
    const w = a.windowId!;
    byWin.set(w, byWin.get(w) ?? {});
    const dims = byWin.get(w)!;
    dims[a.dimension] = dims[a.dimension] ?? {};
    dims[a.dimension][a.codingPass] = a.code;
  }
  let disagreementsPending = 0;
  for (const dims of byWin.values()) {
    let disagree = false;
    let resolved = true;
    for (const dim of ['affect', 'behavior']) {
      const p = dims[dim];
      if (!p) continue;
      if (p.primary_rater_1 && p.primary_rater_2 && p.primary_rater_1 !== p.primary_rater_2) {
        disagree = true;
        if (!p.tiebreaker) resolved = false;
      }
    }
    if (disagree && !resolved) disagreementsPending += 1;
  }

  return {
    windows,
    pctRater1: windows ? r1 / windows : 0,
    pctRater2: windows ? r2 / windows : 0,
    disagreementsPending,
  };
}

export async function libraryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/sessions', async () => {
    const sessions = await prisma.session.findMany({ orderBy: { importedAt: 'desc' } });
    const items: SessionListItem[] = [];
    for (const s of sessions) {
      const [snapshots, gaze, emotion, webcamSegments, chatbot, dialogue, webcamOk] = await Promise.all([
        prisma.snapshot.count({ where: { sessionId: s.id } }),
        prisma.gazeSample.count({ where: { sessionId: s.id } }),
        prisma.emotionFrame.count({ where: { sessionId: s.id } }),
        prisma.webcamSegment.count({ where: { sessionId: s.id } }),
        prisma.chatbotMessage.count({ where: { sessionId: s.id } }),
        prisma.dialogueMessage.count({ where: { sessionId: s.id } }),
        prisma.webcamSegment.count({ where: { sessionId: s.id, status: 'ok' } }),
      ]);
      items.push({
        id: s.id,
        userId: s.userId,
        userDisplayName: s.userDisplayName,
        courseId: s.courseId,
        courseTitle: s.courseTitle,
        startedAt: s.startedAt.toISOString(),
        durationMs: s.durationMs,
        hasWebcam: webcamOk > 0,
        counts: { snapshots, gaze, emotion, webcamSegments, messages: chatbot + dialogue },
        coding: await codingStatus(s.id),
      });
    }
    return { sessions: items };
  });

  // Delete a session's ingested data + media. Optionally also delete coding.
  app.delete<{ Params: { sessionId: string }; Querystring: { deleteCoding?: string } }>(
    '/api/sessions/:sessionId',
    async (req) => {
      const { sessionId } = req.params;
      const deleteCoding = req.query.deleteCoding === 'true';
      await prisma.session.deleteMany({ where: { id: sessionId } });
      await rm(mediaDirFor(sessionId), { recursive: true, force: true });
      if (deleteCoding) {
        await prisma.annotation.deleteMany({ where: { sessionId } });
        await prisma.reliabilityRun.deleteMany({ where: { scope: sessionId } });
      }
      return { ok: true, deletedCoding: deleteCoding };
    },
  );
}
