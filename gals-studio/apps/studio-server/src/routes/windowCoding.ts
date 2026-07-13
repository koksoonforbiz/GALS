import type { FastifyInstance } from 'fastify';
import { prisma } from '../prisma.js';

/**
 * Per-window "perstate-binary" coding (codebook v2.0). A human coder splits the
 * session into fixed-duration windows from 00:00:00 and labels each window for
 * five constructs (behaviour_ontask, engagement, confusion, frustration,
 * boredom), each valued 1 | 0 | ? | NV, with an optional per-construct
 * justification. `neutral` is derived client-side from the four affect
 * constructs and is not stored as a value (only its justification is).
 *
 * Storage is the durable WindowCoding table (no FK to Session, survives a raw-
 * data re-import), keyed by (sessionId, coderId, windowStartMs, windowDurationSec).
 */

const VALUES = ['1', '0', '?', 'NV'] as const;
type CodeValue = (typeof VALUES)[number] | null;

// The five stored construct values and their six justification fields.
const VALUE_FIELDS = [
  'behaviourOntask',
  'engagement',
  'confusion',
  'frustration',
  'boredom',
] as const;
const JUST_FIELDS = [
  'justBehaviourOntask',
  'justEngagement',
  'justConfusion',
  'justFrustration',
  'justBoredom',
  'justNeutral',
] as const;

function cleanValue(v: unknown): CodeValue {
  return typeof v === 'string' && (VALUES as readonly string[]).includes(v)
    ? (v as CodeValue)
    : null;
}
function cleanText(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t.length ? t.slice(0, 2000) : null;
}

export async function windowCodingRoutes(app: FastifyInstance): Promise<void> {
  // Load all stored windows for a coder at a given window duration.
  app.get<{
    Params: { sessionId: string };
    Querystring: { coderId?: string; durationSec?: string };
  }>('/api/window-coding/:sessionId', async (req, reply) => {
    const { sessionId } = req.params;
    const coderId = (req.query.coderId ?? '').trim();
    const durationSec = Number(req.query.durationSec);
    if (!coderId) return reply.code(400).send({ error: 'coderId required' });
    if (!Number.isFinite(durationSec) || durationSec <= 0)
      return reply.code(400).send({ error: 'durationSec required' });

    const rows = await prisma.windowCoding.findMany({
      where: { sessionId, coderId, windowDurationSec: Math.round(durationSec) },
      orderBy: { windowStartMs: 'asc' },
    });
    return { rows };
  });

  // Upsert one window (auto-save on value/justification change).
  app.put<{
    Params: { sessionId: string };
    Body: {
      coderId?: string;
      windowStartMs?: number;
      windowDurationSec?: number;
      codebookVersion?: string;
      values?: Record<string, unknown>;
      justifications?: Record<string, unknown>;
    };
  }>('/api/window-coding/:sessionId', async (req, reply) => {
    const { sessionId } = req.params;
    const coderId = (req.body.coderId ?? '').trim();
    const windowStartMs = Math.round(Number(req.body.windowStartMs));
    const windowDurationSec = Math.round(Number(req.body.windowDurationSec));
    const codebookVersion = (req.body.codebookVersion ?? 'v2.0-perstate-binary').trim();
    if (!coderId) return reply.code(400).send({ error: 'coderId required' });
    if (!Number.isFinite(windowStartMs) || windowStartMs < 0)
      return reply.code(400).send({ error: 'windowStartMs required' });
    if (!Number.isFinite(windowDurationSec) || windowDurationSec <= 0)
      return reply.code(400).send({ error: 'windowDurationSec required' });

    const values = req.body.values ?? {};
    const justifications = req.body.justifications ?? {};
    const data = {
      codebookVersion,
      behaviourOntask: cleanValue(values.behaviourOntask),
      engagement: cleanValue(values.engagement),
      confusion: cleanValue(values.confusion),
      frustration: cleanValue(values.frustration),
      boredom: cleanValue(values.boredom),
      justBehaviourOntask: cleanText(justifications.justBehaviourOntask),
      justEngagement: cleanText(justifications.justEngagement),
      justConfusion: cleanText(justifications.justConfusion),
      justFrustration: cleanText(justifications.justFrustration),
      justBoredom: cleanText(justifications.justBoredom),
      justNeutral: cleanText(justifications.justNeutral),
    };

    const row = await prisma.windowCoding.upsert({
      where: {
        sessionId_coderId_windowStartMs_windowDurationSec: {
          sessionId,
          coderId,
          windowStartMs,
          windowDurationSec,
        },
      },
      create: { sessionId, coderId, windowStartMs, windowDurationSec, ...data },
      update: data,
    });
    return { row };
  });

  // Clear coding — either all durations for the coder, or one duration. Used
  // when the coder changes window duration (existing codes are discarded).
  app.delete<{
    Params: { sessionId: string };
    Querystring: { coderId?: string; durationSec?: string };
  }>('/api/window-coding/:sessionId', async (req, reply) => {
    const { sessionId } = req.params;
    const coderId = (req.query.coderId ?? '').trim();
    if (!coderId) return reply.code(400).send({ error: 'coderId required' });
    const durationSec = Number(req.query.durationSec);
    const where =
      Number.isFinite(durationSec) && durationSec > 0
        ? { sessionId, coderId, windowDurationSec: Math.round(durationSec) }
        : { sessionId, coderId };
    const { count } = await prisma.windowCoding.deleteMany({ where });
    return { ok: true, cleared: count };
  });
}

// exported for potential reuse/tests
export { VALUE_FIELDS, JUST_FIELDS };
