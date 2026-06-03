import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

let dataDir: string;
let app: FastifyInstance;
let prisma: typeof import('../src/prisma.js').prisma;

const get = async (url: string) => (await app.inject({ method: 'GET', url })).json();

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gals-analysis-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STUDIO_DATABASE_URL = `file:${join(dataDir, 'studio.db')}`;
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: join(__dirname, '..'), env: process.env, stdio: 'ignore' });
  ({ prisma } = await import('../src/prisma.js'));
  const { buildServer } = await import('../src/server.js');
  app = await buildServer();

  // session with 6 windows; gold affect track has an unresolved cascade
  await prisma.session.create({ data: { id: 'sa', userId: 'u', courseId: 'c', startedAt: new Date(), durationMs: 120000, timezone: 'UTC', baseWallClockMs: 0, bundleVersion: 1, manifest: '{}', mediaDir: 'sa' } });
  const coder = await prisma.coder.create({ data: { name: 'gold', role: 'expert' } });
  const cb = await prisma.codebookVersion.create({ data: { name: 'cb', version: '1.0', definition: '{}' } });
  const track = ['engaged_concentration', 'confusion', 'confusion', 'frustration', 'boredom', 'boredom'];
  for (let i = 0; i < 6; i++) {
    await prisma.codingWindow.create({ data: { id: `sa:${i}`, sessionId: 'sa', index: i, startWallMs: i * 20000, endWallMs: (i + 1) * 20000, durationMs: 20000 } });
    await prisma.annotation.create({ data: { sessionId: 'sa', windowId: `sa:${i}`, coderId: coder.id, codingPass: 'gold_consensus', codebookVersionId: cb.id, dimension: 'affect', code: track[i] } });
  }
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('analysis endpoints', () => {
  it('dynamics flags the unresolved confusion -> frustration -> boredom cascade', async () => {
    const d = await get('/api/analysis/dynamics?session=sa');
    expect(d.track.filter((t: string | null) => t).length).toBe(6);
    expect(d.unresolved.length).toBe(1);
    expect(d.prevalence.counts.confusion).toBe(2);
  });

  it('reliability returns kappa/PABAK/alpha (no paired raters -> empty)', async () => {
    const r = await get('/api/analysis/reliability?scope=sa&dimension=affect');
    // only gold rows exist (no primary_rater_1/2), so no paired windows
    expect(r.nWindows).toBe(0);
    expect(typeof r.kappa).toBe('number');
  });

  it('gold labels CSV round-trips the consensus track', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/analysis/export/gold?scope=sa' });
    const csv = res.body;
    expect(csv).toContain('affect');
    expect(csv).toContain('frustration');
    expect(csv.trim().split('\n').length).toBe(7); // header + 6 windows
  });
});
