import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

let dataDir: string;
let app: FastifyInstance;
let prisma: typeof import('../src/prisma.js').prisma;

async function post(url: string, body: unknown) {
  const res = await app.inject({ method: 'POST', url, payload: body });
  return { status: res.statusCode, body: res.json() };
}
async function get(url: string) {
  const res = await app.inject({ method: 'GET', url });
  return res.json();
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gals-coding-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STUDIO_DATABASE_URL = `file:${join(dataDir, 'studio.db')}`;
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: join(__dirname, '..'), env: process.env, stdio: 'ignore' });
  ({ prisma } = await import('../src/prisma.js'));
  const { buildServer } = await import('../src/server.js');
  app = await buildServer();

  // seed a session with 2 coding windows
  await prisma.session.create({
    data: { id: 's1', userId: 'u1', courseId: 'c1', startedAt: new Date(), durationMs: 40000, timezone: 'UTC', baseWallClockMs: 1000, bundleVersion: 1, manifest: '{}', mediaDir: 's1' },
  });
  await prisma.codingWindow.createMany({
    data: [
      { id: 's1:0', sessionId: 's1', index: 0, startWallMs: 1000, endWallMs: 21000, durationMs: 20000 },
      { id: 's1:1', sessionId: 's1', index: 1, startWallMs: 21000, endWallMs: 41000, durationMs: 20000 },
    ],
  });
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('coding workflow', () => {
  it('two raters produce independent sets; a disagreement is flagged; tiebreaker + gold resolve it', async () => {
    const r1 = (await post('/api/coders', { name: 'Rater 1', role: 'trained_rater' })).body;
    const r2 = (await post('/api/coders', { name: 'Rater 2', role: 'trained_rater' })).body;
    const tb = (await post('/api/coders', { name: 'Tie', role: 'tiebreaker' })).body;

    // window 0: agree on affect=engaged; window 1: disagree (confusion vs boredom)
    await post('/api/annotations', { sessionId: 's1', windowId: 's1:0', coderId: r1.id, codingPass: 'primary_rater_1', dimension: 'affect', code: 'engaged_concentration' });
    await post('/api/annotations', { sessionId: 's1', windowId: 's1:0', coderId: r2.id, codingPass: 'primary_rater_2', dimension: 'affect', code: 'engaged_concentration' });
    await post('/api/annotations', { sessionId: 's1', windowId: 's1:1', coderId: r1.id, codingPass: 'primary_rater_1', dimension: 'affect', code: 'confusion' });
    await post('/api/annotations', { sessionId: 's1', windowId: 's1:1', coderId: r2.id, codingPass: 'primary_rater_2', dimension: 'affect', code: 'boredom' });

    const dq = await get('/api/coding/s1/disagreements');
    expect(dq.pending).toBe(1);
    expect(dq.disagreements[0].windowId).toBe('s1:1');
    expect(dq.disagreements[0].rater1.code).toBe('confusion');
    expect(dq.disagreements[0].rater2.code).toBe('boredom');

    // tiebreaker resolves window 1 -> confusion
    await post('/api/annotations', { sessionId: 's1', windowId: 's1:1', coderId: tb.id, codingPass: 'tiebreaker', dimension: 'affect', code: 'confusion' });
    const dq2 = await get('/api/coding/s1/disagreements');
    expect(dq2.pending).toBe(0);

    // derive gold: window 0 from agreement, window 1 from tiebreaker
    const gold = (await post('/api/coding/s1/derive-gold', {})).body;
    expect(gold.written).toBe(2);
    const goldRows = await prisma.annotation.findMany({ where: { sessionId: 's1', codingPass: 'gold_consensus', dimension: 'affect' } });
    const byWin = Object.fromEntries(goldRows.map((g) => [g.windowId, g.code]));
    expect(byWin['s1:0']).toBe('engaged_concentration');
    expect(byWin['s1:1']).toBe('confusion');
  });

  it('upsert replaces a single-valued affect rather than duplicating', async () => {
    const r = (await post('/api/coders', { name: 'Rater X', role: 'trained_rater' })).body;
    await post('/api/annotations', { sessionId: 's1', windowId: 's1:0', coderId: r.id, codingPass: 'primary_rater_1', dimension: 'affect', code: 'confusion' });
    await post('/api/annotations', { sessionId: 's1', windowId: 's1:0', coderId: r.id, codingPass: 'primary_rater_1', dimension: 'affect', code: 'frustration' });
    const rows = await prisma.annotation.findMany({ where: { sessionId: 's1', windowId: 's1:0', coderId: r.id, dimension: 'affect' } });
    expect(rows).toHaveLength(1);
    expect(rows[0].code).toBe('frustration');
  });
});
