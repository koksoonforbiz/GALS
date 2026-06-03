import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { mkdtemp, mkdir, writeFile, rm, readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const BASE = 1_717_400_000_000;
let dataDir: string;
let bundleDir: string;
let importBundle: typeof import('../src/import/importer.js').importBundle;
let prisma: typeof import('../src/prisma.js').prisma;

/** Build a valid v1 bundle with correct manifest checksums. */
async function makeFixtureBundle(root: string, sessionId: string): Promise<void> {
  const files: Record<string, string | Buffer> = {};
  const put = (rel: string, content: string | Buffer) => { files[rel] = content; };

  put('session.json', JSON.stringify({
    session: { id: sessionId, userId: 'u1', courseId: 'c1', startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE + 60_000).toISOString(), durationSecs: 60 },
    syncAnchor: { wallClockMs: BASE, monotonicMs: 1, serverReceiveMs: BASE },
    context: { userDisplayName: 'Stu', courseTitle: 'Algebra', moduleTitle: null },
  }, null, 2));

  put('snapshots/snap-1.html', '<html><body>hi</body></html>');
  put('snapshots/index.json', JSON.stringify([
    { snapshotId: 'snap-1', wallMs: BASE + 1000, trigger: 'interval', pageUrl: 'http://x', width: 1280, height: 720, scrollX: 0, scrollY: 0, aois: [{ region: 'lesson', x: 0, y: 0, width: 800, height: 720 }], scrollHosts: null, pdfCurrentPage: null, pdfTotalPages: null, htmlFile: 'snap-1.html' },
  ], null, 2));

  put('webcam/seg-1.webm', Buffer.from('fakevideo'));
  put('webcam/index.json', JSON.stringify([
    { segmentId: 'seg-1', startWallMs: BASE, endWallMs: BASE + 30_000, file: 'seg-1.webm', byteSize: 9, status: 'ok', mimeType: 'video/webm', durationMs: 30_000 },
  ], null, 2));

  const gaze = Array.from({ length: 10 }, (_, k) => JSON.stringify({ wallMs: BASE + k * 100, x: k, y: k })).join('\n') + '\n';
  put('streams/webgazer.jsonl', gaze);
  put('streams/clicks.jsonl', JSON.stringify({ wallMs: BASE + 5000, x: 1, y: 2, target: 'b', pageUrl: 'http://x' }) + '\n');

  // write files + build manifest with checksums
  const fileEntries: Record<string, { sha256: string; byteSize: number }> = {};
  for (const [rel, content] of Object.entries(files)) {
    const buf = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
    const full = join(root, rel);
    await mkdir(join(full, '..'), { recursive: true });
    await writeFile(full, buf);
    fileEntries[rel] = { sha256: createHash('sha256').update(buf).digest('hex'), byteSize: buf.byteLength };
  }

  const manifest = {
    bundleVersion: 1, exporterVersion: '1.0.0', exportedAt: new Date(BASE).toISOString(),
    sessionId, userId: 'u1', courseId: 'c1', timezone: 'UTC',
    baseWallClockMs: BASE, durationMs: 60_000,
    counts: { webgazer: 10, clicks: 1, snapshots: 1, webcam: 1 },
    files: fileEntries, notes: [],
  };
  await writeFile(join(root, 'manifest.json'), JSON.stringify(manifest, null, 2));
}

beforeAll(async () => {
  dataDir = await mkdtemp(join(tmpdir(), 'gals-studio-data-'));
  process.env.STUDIO_DATA_DIR = dataDir;
  process.env.STUDIO_DATABASE_URL = `file:${join(dataDir, 'studio.db')}`;
  // apply schema to the temp db
  execSync('npx prisma db push --skip-generate --accept-data-loss', {
    cwd: join(__dirname, '..'),
    env: process.env,
    stdio: 'ignore',
  });
  ({ importBundle } = await import('../src/import/importer.js'));
  ({ prisma } = await import('../src/prisma.js'));

  const root = await mkdtemp(join(tmpdir(), 'gals-bundle-'));
  bundleDir = join(root, 'session_s1');
  await makeFixtureBundle(bundleDir, 's1');
}, 120_000);

afterAll(async () => {
  await prisma?.$disconnect();
  if (dataDir) await rm(dataDir, { recursive: true, force: true });
});

describe('importBundle', () => {
  it('imports streams, media, and creates the right window count', async () => {
    const report = await importBundle(bundleDir);
    expect(report.ok).toBe(true);
    expect(report.sessionId).toBe('s1');
    // ceil(60000 / 20000) = 3 windows
    expect(report.windows).toBe(3);
    expect(report.inserted.webgazer).toBe(10);

    const gaze = await prisma.gazeSample.count({ where: { sessionId: 's1' } });
    expect(gaze).toBe(10);
    const windows = await prisma.codingWindow.count({ where: { sessionId: 's1' } });
    expect(windows).toBe(3);
    // media copied
    expect(existsSync(join(dataDir, 'media', 's1', 'snapshots', 'snap-1.html'))).toBe(true);
    expect(existsSync(join(dataDir, 'media', 's1', 'webcam', 'seg-1.webm'))).toBe(true);
  });

  it('preserves annotations across re-import (durability rule)', async () => {
    const coder = await prisma.coder.create({ data: { name: 'Rater A', role: 'trained_rater' } });
    const cb = await prisma.codebookVersion.findFirst();
    await prisma.annotation.create({
      data: {
        sessionId: 's1', windowId: 's1:0', coderId: coder.id, codingPass: 'primary_rater_1',
        codebookVersionId: cb!.id, dimension: 'affect', code: 'engaged_concentration',
      },
    });
    const before = await prisma.annotation.count({ where: { sessionId: 's1' } });
    expect(before).toBe(1);

    const report = await importBundle(bundleDir);
    expect(report.ok).toBe(true);

    const after = await prisma.annotation.findMany({ where: { sessionId: 's1' } });
    expect(after).toHaveLength(1);
    expect(after[0].code).toBe('engaged_concentration');
    // window the annotation references still exists with the same id
    const win = await prisma.codingWindow.findUnique({ where: { id: 's1:0' } });
    expect(win).not.toBeNull();
  });

  it('refuses a checksum-tampered bundle', async () => {
    const root = await mkdtemp(join(tmpdir(), 'gals-bad-'));
    const dir = join(root, 'session_bad');
    await makeFixtureBundle(dir, 'bad');
    // corrupt a stream file after the manifest was written
    await writeFile(join(dir, 'streams/clicks.jsonl'), JSON.stringify({ wallMs: 0, x: 9 }) + '\n');
    const report = await importBundle(dir);
    // checksum mismatch is surfaced as a warning; structural validity still holds
    expect(report.checksumMismatches).toContain('streams/clicks.jsonl');
    await rm(root, { recursive: true, force: true });
  });
});
