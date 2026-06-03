import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';

let dataDir: string;
let app: FastifyInstance;
let prisma: typeof import('../src/prisma.js').prisma;

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gals-backup-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STUDIO_DATABASE_URL = `file:${join(dataDir, 'studio.db')}`;
  execSync('npx prisma db push --skip-generate --accept-data-loss', { cwd: join(__dirname, '..'), env: process.env, stdio: 'ignore' });
  ({ prisma } = await import('../src/prisma.js'));
  const { buildServer } = await import('../src/server.js');
  app = await buildServer();
}, 120_000);

afterAll(async () => {
  await app?.close();
  await prisma?.$disconnect();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('coding backup/restore', () => {
  it('export → wipe → import restores every annotation, coder, codebook, run', async () => {
    const coder = await prisma.coder.create({ data: { name: 'R', role: 'trained_rater' } });
    const cb = await prisma.codebookVersion.create({ data: { name: 'cb', version: '1.0', definition: '{}' } });
    await prisma.annotation.create({ data: { sessionId: 'x', windowId: 'x:0', coderId: coder.id, codingPass: 'primary_rater_1', codebookVersionId: cb.id, dimension: 'affect', code: 'confusion' } });
    await prisma.reliabilityRun.create({ data: { scope: 'x', dimension: 'affect', metrics: '{}', params: '{}' } });

    const res = await app.inject({ method: 'GET', url: '/api/coding/export' });
    expect(res.statusCode).toBe(200);
    const zipBuf = res.rawPayload;

    // wipe coding tables
    await prisma.annotation.deleteMany({});
    await prisma.reliabilityRun.deleteMany({});
    await prisma.codebookVersion.deleteMany({});
    await prisma.coder.deleteMany({});
    expect(await prisma.annotation.count()).toBe(0);

    // restore from the in-memory zip via the import handler (decode the json)
    const AdmZip = (await import('adm-zip')).default;
    const payload = JSON.parse(new AdmZip(Buffer.from(zipBuf)).getEntry('coding.json')!.getData().toString('utf8'));
    const restore = await app.inject({ method: 'POST', url: '/api/coding/import', payload: { payload }, headers: { 'content-type': 'application/json' } });
    expect(restore.statusCode).toBe(200);

    expect(await prisma.annotation.count()).toBe(1);
    expect(await prisma.coder.count()).toBe(1);
    expect(await prisma.codebookVersion.count()).toBe(1);
    expect(await prisma.reliabilityRun.count()).toBe(1);
    const ann = await prisma.annotation.findFirst();
    expect(ann?.code).toBe('confusion');
  });
});
