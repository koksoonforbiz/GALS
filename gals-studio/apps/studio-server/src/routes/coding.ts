import type { FastifyInstance } from 'fastify';
import { DEFAULT_CODEBOOK } from '@gals-studio/shared';
import { prisma } from '../prisma.js';
import { ensureDefaultCodebook } from '../import/importer.js';
import { getTrim, wallInRange, retainedDurationMs, isTrimmed } from '../analysis/trim.js';

const SINGLE_DIMS = ['affect', 'behavior'];

interface AnnotationBody {
  sessionId: string;
  windowId?: string | null;
  coderId: string;
  codingPass: string;
  dimension: string;
  code: string;
  intensity?: number | null;
  confidence?: string | null;
  atWallMs?: number | null;
  startWallMs?: number | null;
  endWallMs?: number | null;
  notes?: string | null;
  codingMs?: number | null;
  codebookVersionId?: string;
  machineGuess?: string | null;
}

export async function codingRoutes(app: FastifyInstance): Promise<void> {
  // ── Codebook ───────────────────────────────────────────────────────────
  app.get('/api/codebook', async () => {
    await ensureDefaultCodebook();
    const versions = await prisma.codebookVersion.findMany({ orderBy: { createdAt: 'asc' } });
    return {
      versions: versions.map((v) => ({
        id: v.id,
        name: v.name,
        version: v.version,
        locked: v.locked,
        definition: safeParse(v.definition),
      })),
      defaultDefinition: DEFAULT_CODEBOOK,
    };
  });

  // Create or fork a codebook version. Editing a locked version forks a new one.
  app.post<{
    Body: { id?: string; name?: string; version?: string; definition?: unknown; lock?: boolean };
  }>('/api/codebook', async (req, reply) => {
    const { id, name, version, definition, lock } = req.body;
    if (id) {
      const existing = await prisma.codebookVersion.findUnique({ where: { id } });
      if (!existing) return reply.code(404).send({ error: 'version not found' });
      if (lock) {
        const locked = await prisma.codebookVersion.update({
          where: { id },
          data: { locked: true },
        });
        return { id: locked.id, locked: true };
      }
      if (existing.locked) {
        // fork
        const forkVersion = bumpVersion(existing.version);
        const fork = await prisma.codebookVersion.create({
          data: {
            name: existing.name,
            version: forkVersion,
            definition: JSON.stringify(definition ?? safeParse(existing.definition)),
            locked: false,
          },
        });
        return { id: fork.id, forkedFrom: id, version: forkVersion };
      }
      const updated = await prisma.codebookVersion.update({
        where: { id },
        data: { definition: JSON.stringify(definition ?? safeParse(existing.definition)) },
      });
      return { id: updated.id, version: updated.version };
    }
    const created = await prisma.codebookVersion.create({
      data: {
        name: name ?? 'Custom',
        version: version ?? '1.0',
        definition: JSON.stringify(definition ?? DEFAULT_CODEBOOK),
        locked: false,
      },
    });
    return { id: created.id, version: created.version };
  });

  // ── Coders ──────────────────────────────────────────────────────────────
  app.get('/api/coders', async () => ({
    coders: await prisma.coder.findMany({ orderBy: { createdAt: 'asc' } }),
  }));
  app.post<{ Body: { name: string; role: string } }>('/api/coders', async (req, reply) => {
    const { name, role } = req.body;
    if (!name) return reply.code(400).send({ error: 'name required' });
    return prisma.coder.create({ data: { name, role: role || 'trained_rater' } });
  });

  // ── Annotation upsert ─────────────────────────────────────────────────────
  app.post<{ Body: AnnotationBody }>('/api/annotations', async (req, reply) => {
    const b = req.body;
    if (!b.sessionId || !b.coderId || !b.codingPass || !b.dimension || !b.code) {
      return reply.code(400).send({ error: 'missing required annotation fields' });
    }
    const codebookVersionId = b.codebookVersionId ?? (await ensureDefaultCodebook());

    // single-valued (affect/behavior): upsert on (windowId,coderId,pass,dimension)
    if (SINGLE_DIMS.includes(b.dimension) && b.windowId) {
      const existing = await prisma.annotation.findFirst({
        where: {
          sessionId: b.sessionId,
          windowId: b.windowId,
          coderId: b.coderId,
          codingPass: b.codingPass,
          dimension: b.dimension,
        },
      });
      if (existing) {
        const updated = await prisma.annotation.update({
          where: { id: existing.id },
          data: {
            code: b.code,
            intensity: b.intensity ?? null,
            confidence: b.confidence ?? null,
            notes: b.notes ?? null,
            codingMs: b.codingMs ?? existing.codingMs,
            codebookVersionId,
          },
        });
        return updated;
      }
    }
    // multi-valued (ef_event/motivation) or point/range: create
    return prisma.annotation.create({
      data: {
        sessionId: b.sessionId,
        windowId: b.windowId ?? null,
        coderId: b.coderId,
        codingPass: b.codingPass,
        codebookVersionId,
        dimension: b.dimension,
        code: b.code,
        intensity: b.intensity ?? null,
        confidence: b.confidence ?? null,
        atWallMs: b.atWallMs ?? null,
        startWallMs: b.startWallMs ?? null,
        endWallMs: b.endWallMs ?? null,
        notes: b.notes ?? null,
        codingMs: b.codingMs ?? null,
        machineGuess: b.machineGuess ?? null,
      },
    });
  });

  app.delete<{ Params: { id: string } }>('/api/annotations/:id', async (req) => {
    await prisma.annotation.deleteMany({ where: { id: req.params.id } });
    return { ok: true };
  });

  // Patch an existing annotation (timeline interval resize / recode / coding).
  app.patch<{
    Params: { id: string };
    Body: {
      startWallMs?: number;
      endWallMs?: number;
      notes?: string | null;
      code?: string;
      intensity?: number | null;
      confidence?: string | null;
      machineGuess?: string | null;
    };
  }>('/api/annotations/:id', async (req, reply) => {
    const b = req.body;
    const data: Record<string, unknown> = {};
    if (b.startWallMs !== undefined) data.startWallMs = b.startWallMs;
    if (b.endWallMs !== undefined) data.endWallMs = b.endWallMs;
    if (b.notes !== undefined) data.notes = b.notes;
    if (b.code !== undefined) data.code = b.code;
    if (b.intensity !== undefined) data.intensity = b.intensity;
    if (b.confidence !== undefined) data.confidence = b.confidence;
    if (b.machineGuess !== undefined) data.machineGuess = b.machineGuess;
    if (Object.keys(data).length === 0) return reply.code(400).send({ error: 'nothing to update' });
    try {
      return await prisma.annotation.update({ where: { id: req.params.id }, data });
    } catch {
      return reply.code(404).send({ error: 'annotation not found' });
    }
  });

  // ── Researcher AOIs (drawn on the replay; durable across re-import) ────────
  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/aois', async (req) => {
    const rows = await prisma.sessionAoi.findMany({
      where: { sessionId: req.params.sessionId },
      orderBy: { createdAt: 'asc' },
    });
    return { aois: rows };
  });
  app.post<{
    Params: { sessionId: string };
    Body: { name?: string; x: number; y: number; width: number; height: number; color?: string };
  }>('/api/sessions/:sessionId/aois', async (req, reply) => {
    const b = req.body;
    if ([b.x, b.y, b.width, b.height].some((n) => typeof n !== 'number'))
      return reply.code(400).send({ error: 'x,y,width,height required' });
    return prisma.sessionAoi.create({
      data: {
        sessionId: req.params.sessionId,
        name: b.name?.trim() || 'AOI',
        x: b.x,
        y: b.y,
        width: b.width,
        height: b.height,
        color: b.color ?? null,
      },
    });
  });
  app.delete<{ Params: { id: string } }>('/api/aois/:id', async (req) => {
    await prisma.sessionAoi.deleteMany({ where: { id: req.params.id } });
    return { ok: true };
  });

  // ── Session trim (retained window): crop dead head/tail so the summary and
  // exports reflect only the active part. Offsets are ms from baseWallClockMs. ─
  app.get<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/trim', async (req) => {
    const t = await prisma.sessionTrim.findUnique({ where: { sessionId: req.params.sessionId } });
    return { startMs: t?.startMs ?? null, endMs: t?.endMs ?? null };
  });
  app.put<{
    Params: { sessionId: string };
    Body: { startMs?: number | null; endMs?: number | null };
  }>('/api/sessions/:sessionId/trim', async (req, reply) => {
    const { sessionId } = req.params;
    const startMs = req.body.startMs ?? null;
    const endMs = req.body.endMs ?? null;
    if (startMs != null && endMs != null && endMs <= startMs)
      return reply.code(400).send({ error: 'endMs must be greater than startMs' });
    // clearing both bounds removes the trim entirely
    if (startMs == null && endMs == null) {
      await prisma.sessionTrim.deleteMany({ where: { sessionId } });
      return { startMs: null, endMs: null };
    }
    const row = await prisma.sessionTrim.upsert({
      where: { sessionId },
      update: { startMs, endMs },
      create: { sessionId, startMs, endMs },
    });
    return { startMs: row.startMs ?? null, endMs: row.endMs ?? null };
  });
  app.delete<{ Params: { sessionId: string } }>('/api/sessions/:sessionId/trim', async (req) => {
    await prisma.sessionTrim.deleteMany({ where: { sessionId: req.params.sessionId } });
    return { ok: true };
  });

  // ── Timeline interval annotations (free-range coding, no window) ───────────
  // Stored as Annotation rows with codingPass='timeline' & windowId=null, so
  // they never enter the window-based reliability/gold computations.
  app.get<{ Params: { sessionId: string }; Querystring: { coderId?: string } }>(
    '/api/coding/:sessionId/intervals',
    async (req) => {
      const { sessionId } = req.params;
      const { coderId } = req.query;
      const rows = await prisma.annotation.findMany({
        where: { sessionId, codingPass: 'timeline', ...(coderId ? { coderId } : {}) },
        orderBy: { startWallMs: 'asc' },
      });
      return {
        intervals: rows.map((a) => ({
          id: a.id,
          coderId: a.coderId,
          dimension: a.dimension,
          code: a.code,
          startWallMs: a.startWallMs,
          endWallMs: a.endWallMs,
          notes: a.notes,
          intensity: a.intensity,
          confidence: a.confidence,
          machineGuess: a.machineGuess,
        })),
      };
    },
  );

  // ── Session summary: coding, intervention scores, time, abandonment ───────
  app.get<{ Params: { sessionId: string }; Querystring: { coderId?: string } }>(
    '/api/coding/:sessionId/summary',
    async (req, reply) => {
      const { sessionId } = req.params;
      const { coderId } = req.query;
      const session = await prisma.session.findUnique({ where: { id: sessionId } });
      if (!session) return reply.code(404).send({ error: 'session not found' });
      const range = await getTrim(sessionId);
      const base = session.baseWallClockMs;
      const keep = wallInRange(base, range);
      // chatbot messages within the retained window (count via a wall-clock range)
      const chatWhere =
        range.startMs == null && range.endMs == null
          ? { sessionId }
          : {
              sessionId,
              wallMs: {
                ...(range.startMs != null ? { gte: base + range.startMs } : {}),
                ...(range.endMs != null ? { lte: base + range.endMs } : {}),
              },
            };
      const [allInterventions, allVis, allMarks, allEfMarks, lastActivity, messages] =
        await Promise.all([
          prisma.intervention.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
          prisma.visibility.findMany({ where: { sessionId }, orderBy: { wallMs: 'asc' } }),
          prisma.annotation.findMany({
            where: {
              sessionId,
              codingPass: 'timeline',
              dimension: 'affect',
              ...(coderId ? { coderId } : {}),
            },
          }),
          prisma.annotation.findMany({
            where: {
              sessionId,
              codingPass: 'timeline',
              dimension: 'ef_event',
              ...(coderId ? { coderId } : {}),
            },
          }),
          prisma.activityEvent.findFirst({
            where: chatWhere, // last activity within the retained window
            orderBy: { wallMs: 'desc' },
          }),
          prisma.chatbotMessage.count({ where: chatWhere }),
        ]);

      // restrict everything to the retained window
      const interventions = allInterventions.filter((iv) => keep(iv.wallMs));
      const visibilities = allVis.filter((v) => keep(v.wallMs));
      const marks = allMarks.filter((m) => keep(m.atWallMs ?? m.startWallMs ?? base));
      const efMarks = allEfMarks.filter((m) => keep(m.atWallMs ?? base));
      const ivs = interventions.map((iv) => {
        let score: number | null = null;
        try {
          const d = JSON.parse(iv.sessionData ?? '{}');
          if (typeof d?.score === 'number') score = d.score;
        } catch {
          /* ignore */
        }
        return { type: iv.type, status: iv.status, score, atMs: iv.wallMs - base };
      });
      const completed = ivs.filter((i) => (i.status ?? '').toUpperCase() === 'COMPLETED').length;
      const incomplete = ivs.length - completed;
      const scored = ivs.filter((i) => i.score != null);
      const avgScore = scored.length
        ? scored.reduce((s, i) => s + (i.score as number), 0) / scored.length
        : null;

      const totalMs = retainedDurationMs(session.durationMs, range);
      const hiddenMs = visibilities.reduce((s, v) => s + (v.hiddenDurationMs ?? 0), 0);
      const activeMs = Math.max(0, totalMs - hiddenMs);
      const lastVis = visibilities[visibilities.length - 1];

      const byAffect: Record<string, { count: number; totalMs: number; intensities: number[] }> =
        {};
      for (const m of marks) {
        const a = (byAffect[m.code] ??= { count: 0, totalMs: 0, intensities: [] });
        a.count += 1;
        if (m.startWallMs != null && m.endWallMs != null) a.totalMs += m.endWallMs - m.startWallMs;
        if (m.intensity != null) a.intensities.push(m.intensity);
      }
      const coding = Object.entries(byAffect).map(([code, a]) => ({
        code,
        count: a.count,
        totalMs: a.totalMs,
        avgIntensity: a.intensities.length
          ? a.intensities.reduce((s, x) => s + x, 0) / a.intensities.length
          : null,
      }));

      // coder EF coding (text-mining detections validated/recoded by the coder)
      const efByConstruct: Record<string, number> = {};
      let efAgree = 0;
      let efWithGuess = 0;
      for (const e of efMarks) {
        efByConstruct[e.code] = (efByConstruct[e.code] ?? 0) + 1;
        if (e.machineGuess != null) {
          efWithGuess += 1;
          if (e.machineGuess === e.code) efAgree += 1;
        }
      }
      const efCoding = {
        count: efMarks.length,
        byConstruct: Object.entries(efByConstruct)
          .map(([construct, count]) => ({ construct, count }))
          .sort((a, b) => b.count - a.count),
        agreement: {
          withGuess: efWithGuess,
          agree: efAgree,
          pct: efWithGuess ? efAgree / efWithGuess : null,
        },
      };

      const signals: string[] = [];
      if (!session.endedAt) signals.push('session has no end timestamp');
      if (incomplete > 0) signals.push(`${incomplete} intervention(s) not completed`);
      if (lastVis && (lastVis.visibleState ?? 'visible') !== 'visible')
        signals.push('page was hidden at the last visibility event');

      return {
        session: {
          userDisplayName: session.userDisplayName,
          startedAt: session.startedAt.toISOString(),
          endedAt: session.endedAt ? session.endedAt.toISOString() : null,
        },
        time: {
          totalMs,
          activeMs,
          hiddenMs,
          lastActivityMs: lastActivity ? lastActivity.wallMs - base : null,
        },
        interventions: { items: ivs, total: ivs.length, completed, incomplete, avgScore },
        coding: { marks: marks.length, byAffect: coding },
        efCoding,
        engagement: { chatbotMessages: messages },
        abandoned: { likely: signals.length > 0, signals },
        trim: {
          trimmed: isTrimmed(range),
          startMs: range.startMs,
          endMs: range.endMs,
          fullDurationMs: session.durationMs,
        },
      };
    },
  );

  // ── Coder EF coding (validate/recode the text-mining EF detections) ────────
  // Stored as point Annotations (dimension='ef_event', codingPass='timeline'),
  // keyed by atWallMs so each detection has at most one coding per coder.
  app.get<{ Params: { sessionId: string }; Querystring: { coderId?: string } }>(
    '/api/coding/:sessionId/ef-codings',
    async (req) => {
      const { sessionId } = req.params;
      const { coderId } = req.query;
      const rows = await prisma.annotation.findMany({
        where: {
          sessionId,
          codingPass: 'timeline',
          dimension: 'ef_event',
          ...(coderId ? { coderId } : {}),
        },
        orderBy: { atWallMs: 'asc' },
      });
      return {
        codings: rows.map((a) => ({
          id: a.id,
          coderId: a.coderId,
          atWallMs: a.atWallMs,
          code: a.code,
          confidence: a.confidence,
          notes: a.notes,
          machineGuess: a.machineGuess,
        })),
      };
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: {
      coderId: string;
      atWallMs: number;
      code: string;
      confidence?: string | null;
      notes?: string | null;
      machineGuess?: string | null;
    };
  }>('/api/coding/:sessionId/ef-codings', async (req, reply) => {
    const { sessionId } = req.params;
    const b = req.body;
    if (!b.coderId || typeof b.atWallMs !== 'number' || !b.code) {
      return reply.code(400).send({ error: 'coderId, atWallMs, code required' });
    }
    // identity of a detection is (timestamp, machine construct): multiple
    // constructs can fire at the same wallMs, and each is coded independently.
    const existing = await prisma.annotation.findFirst({
      where: {
        sessionId,
        coderId: b.coderId,
        codingPass: 'timeline',
        dimension: 'ef_event',
        atWallMs: b.atWallMs,
        machineGuess: b.machineGuess ?? null,
      },
    });
    if (existing) {
      return prisma.annotation.update({
        where: { id: existing.id },
        data: {
          code: b.code,
          confidence: b.confidence ?? null,
          notes: b.notes ?? null,
          machineGuess: b.machineGuess ?? existing.machineGuess,
        },
      });
    }
    const codebookVersionId = await ensureDefaultCodebook();
    return prisma.annotation.create({
      data: {
        sessionId,
        coderId: b.coderId,
        codingPass: 'timeline',
        dimension: 'ef_event',
        codebookVersionId,
        code: b.code,
        atWallMs: b.atWallMs,
        confidence: b.confidence ?? null,
        notes: b.notes ?? null,
        machineGuess: b.machineGuess ?? null,
      },
    });
  });

  // ── Per-utterance coding (chat / dialogue / intervention) ─────────────────
  app.get<{ Params: { sessionId: string }; Querystring: { coderId?: string } }>(
    '/api/coding/:sessionId/utterances',
    async (req) => {
      const { sessionId } = req.params;
      const { coderId } = req.query;
      const codings = await prisma.utteranceCoding.findMany({
        where: { sessionId, ...(coderId ? { coderId } : {}) },
        orderBy: { refWallMs: 'asc' },
      });
      return { codings };
    },
  );

  app.post<{
    Params: { sessionId: string };
    Body: {
      coderId: string;
      source: string;
      refWallMs: number;
      role?: string | null;
      preview?: string | null;
      efConstruct?: string | null;
      affect?: string | null;
      strategy?: string | null;
      notes?: string | null;
    };
  }>('/api/coding/:sessionId/utterances', async (req, reply) => {
    const { sessionId } = req.params;
    const b = req.body;
    if (!b.coderId || !b.source || typeof b.refWallMs !== 'number') {
      return reply.code(400).send({ error: 'coderId, source, refWallMs required' });
    }
    const fields = {
      role: b.role ?? null,
      preview: b.preview ?? null,
      efConstruct: b.efConstruct ?? null,
      affect: b.affect ?? null,
      strategy: b.strategy ?? null,
      notes: b.notes ?? null,
    };
    return prisma.utteranceCoding.upsert({
      where: {
        sessionId_coderId_source_refWallMs: {
          sessionId,
          coderId: b.coderId,
          source: b.source,
          refWallMs: b.refWallMs,
        },
      },
      update: fields,
      create: {
        sessionId,
        coderId: b.coderId,
        source: b.source,
        refWallMs: b.refWallMs,
        ...fields,
      },
    });
  });

  app.delete<{ Params: { id: string } }>('/api/coding/utterances/:id', async (req) => {
    await prisma.utteranceCoding.deleteMany({ where: { id: req.params.id } });
    return { ok: true };
  });

  // CSV export of the utterance coding for a session (one row per coded utterance).
  app.get<{ Params: { sessionId: string }; Querystring: { coderId?: string } }>(
    '/api/coding/:sessionId/utterances/export',
    async (req, reply) => {
      const { sessionId } = req.params;
      const { coderId } = req.query;
      const [rows, session] = await Promise.all([
        prisma.utteranceCoding.findMany({
          where: { sessionId, ...(coderId ? { coderId } : {}) },
          orderBy: { refWallMs: 'asc' },
        }),
        prisma.session.findUnique({ where: { id: sessionId } }),
      ]);
      const base = session?.baseWallClockMs ?? 0;
      const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const header = [
        'sessionId',
        'coderId',
        'relSec',
        'source',
        'role',
        'efConstruct',
        'affect',
        'strategy',
        'notes',
        'preview',
      ];
      const lines = [header.join(',')];
      for (const r of rows) {
        lines.push(
          [
            sessionId,
            r.coderId,
            Math.round((r.refWallMs - base) / 1000),
            r.source,
            r.role,
            r.efConstruct,
            r.affect,
            r.strategy,
            r.notes,
            r.preview,
          ]
            .map(esc)
            .join(','),
        );
      }
      reply
        .header('Content-Type', 'text/csv; charset=utf-8')
        .header('Content-Disposition', `attachment; filename="utterance-coding-${sessionId}.csv"`)
        .send(lines.join('\n'));
    },
  );

  // Clear affect for a window/coder/pass (the '0' key).
  app.post<{
    Body: {
      sessionId: string;
      windowId: string;
      coderId: string;
      codingPass: string;
      dimension: string;
    };
  }>('/api/annotations/clear', async (req) => {
    const { sessionId, windowId, coderId, codingPass, dimension } = req.body;
    await prisma.annotation.deleteMany({
      where: { sessionId, windowId, coderId, codingPass, dimension },
    });
    return { ok: true };
  });

  // ── Coding state for a coder/pass ─────────────────────────────────────────
  app.get<{ Params: { sessionId: string }; Querystring: { coderId?: string; pass?: string } }>(
    '/api/coding/:sessionId/state',
    async (req) => {
      const { sessionId } = req.params;
      const { coderId, pass } = req.query;
      const windows = await prisma.codingWindow.findMany({
        where: { sessionId },
        orderBy: { index: 'asc' },
      });
      const anns =
        coderId && pass
          ? await prisma.annotation.findMany({ where: { sessionId, coderId, codingPass: pass } })
          : [];
      const byWindow: Record<string, any> = {};
      for (const w of windows)
        byWindow[w.id] = { affect: null, behavior: null, ef_event: [], motivation: [] };
      let missingAffect = 0;
      for (const a of anns) {
        if (!a.windowId || !byWindow[a.windowId]) continue;
        const slot = byWindow[a.windowId];
        if (a.dimension === 'affect') slot.affect = annDto(a);
        else if (a.dimension === 'behavior') slot.behavior = annDto(a);
        else slot[a.dimension]?.push(annDto(a));
      }
      const codedAffect = windows.filter((w) => byWindow[w.id].affect).length;
      const codedBehavior = windows.filter((w) => byWindow[w.id].behavior).length;
      for (const w of windows) if (!byWindow[w.id].affect) missingAffect += 1;

      return {
        windows: windows.map((w) => ({
          id: w.id,
          index: w.index,
          startWallMs: w.startWallMs,
          endWallMs: w.endWallMs,
          durationMs: w.durationMs,
        })),
        annotations: byWindow,
        progress: { total: windows.length, codedAffect, codedBehavior, missingAffect },
      };
    },
  );

  // ── Disagreement queue ────────────────────────────────────────────────────
  app.get<{ Params: { sessionId: string } }>(
    '/api/coding/:sessionId/disagreements',
    async (req) => {
      const { sessionId } = req.params;
      const anns = await prisma.annotation.findMany({
        where: {
          sessionId,
          codingPass: { in: ['primary_rater_1', 'primary_rater_2', 'tiebreaker'] },
          dimension: { in: ['affect', 'behavior'] },
          windowId: { not: null },
        },
      });
      const windows = await prisma.codingWindow.findMany({
        where: { sessionId },
        orderBy: { index: 'asc' },
      });
      const winMeta = new Map(windows.map((w) => [w.id, w]));
      const byWin = new Map<string, Record<string, Record<string, any>>>();
      for (const a of anns) {
        const w = a.windowId!;
        byWin.set(w, byWin.get(w) ?? {});
        const dims = byWin.get(w)!;
        dims[a.dimension] = dims[a.dimension] ?? {};
        dims[a.dimension][a.codingPass] = annDto(a);
      }
      const disagreements: any[] = [];
      for (const [winId, dims] of byWin) {
        for (const dim of ['affect', 'behavior']) {
          const p = dims[dim];
          if (
            p?.primary_rater_1 &&
            p?.primary_rater_2 &&
            p.primary_rater_1.code !== p.primary_rater_2.code
          ) {
            const w = winMeta.get(winId);
            disagreements.push({
              windowId: winId,
              index: w?.index,
              startWallMs: w?.startWallMs,
              endWallMs: w?.endWallMs,
              dimension: dim,
              rater1: p.primary_rater_1,
              rater2: p.primary_rater_2,
              tiebreaker: p.tiebreaker ?? null,
              resolved: !!p.tiebreaker,
            });
          }
        }
      }
      disagreements.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
      return { disagreements, pending: disagreements.filter((d) => !d.resolved).length };
    },
  );

  // ── Gold consensus derivation ─────────────────────────────────────────────
  app.post<{ Params: { sessionId: string } }>('/api/coding/:sessionId/derive-gold', async (req) => {
    const { sessionId } = req.params;
    const anns = await prisma.annotation.findMany({
      where: {
        sessionId,
        codingPass: { in: ['primary_rater_1', 'primary_rater_2', 'tiebreaker'] },
        dimension: { in: ['affect', 'behavior'] },
        windowId: { not: null },
      },
    });
    const goldCoder = await goldConsensusCoder();
    const codebookVersionId = await ensureDefaultCodebook();

    // wipe prior gold for this scope only (idempotent re-derive)
    await prisma.annotation.deleteMany({ where: { sessionId, codingPass: 'gold_consensus' } });

    const byWin = new Map<string, Record<string, Record<string, any>>>();
    for (const a of anns) {
      const w = a.windowId!;
      byWin.set(w, byWin.get(w) ?? {});
      const dims = byWin.get(w)!;
      dims[a.dimension] = dims[a.dimension] ?? {};
      dims[a.dimension][a.codingPass] = a;
    }
    let written = 0;
    const needsTiebreak: { windowId: string; dimension: string }[] = [];
    for (const [winId, dims] of byWin) {
      for (const dim of ['affect', 'behavior']) {
        const p = dims[dim];
        if (!p) continue;
        let goldCode: string | null = null;
        if (
          p.primary_rater_1 &&
          p.primary_rater_2 &&
          p.primary_rater_1.code === p.primary_rater_2.code
        ) {
          goldCode = p.primary_rater_1.code;
        } else if (p.primary_rater_1 && p.primary_rater_2 && p.tiebreaker) {
          goldCode = p.tiebreaker.code;
        } else if (p.primary_rater_1 && !p.primary_rater_2) {
          goldCode = p.primary_rater_1.code;
        } else if (p.primary_rater_2 && !p.primary_rater_1) {
          goldCode = p.primary_rater_2.code;
        } else {
          needsTiebreak.push({ windowId: winId, dimension: dim });
        }
        if (goldCode) {
          await prisma.annotation.create({
            data: {
              sessionId,
              windowId: winId,
              coderId: goldCoder,
              codingPass: 'gold_consensus',
              codebookVersionId,
              dimension: dim,
              code: goldCode,
            },
          });
          written += 1;
        }
      }
    }
    return { written, needsTiebreak };
  });
}

function annDto(a: any) {
  return {
    id: a.id,
    code: a.code,
    intensity: a.intensity,
    confidence: a.confidence,
    notes: a.notes,
    atWallMs: a.atWallMs,
    startWallMs: a.startWallMs,
    endWallMs: a.endWallMs,
    coderId: a.coderId,
    machineGuess: a.machineGuess,
  };
}

function safeParse(v: string): unknown {
  try {
    return JSON.parse(v);
  } catch {
    return null;
  }
}

function bumpVersion(version: string): string {
  const parts = version.split('.');
  const minor = Number(parts[1] ?? '0') + 1;
  return `${parts[0] ?? '1'}.${minor}`;
}

/** A synthetic system coder that owns gold_consensus rows. */
async function goldConsensusCoder(): Promise<string> {
  const existing = await prisma.coder.findFirst({
    where: { name: 'gold_consensus', role: 'expert' },
  });
  if (existing) return existing.id;
  const created = await prisma.coder.create({ data: { name: 'gold_consensus', role: 'expert' } });
  return created.id;
}
