import { describe, it, expect, afterAll } from 'vitest';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { exportSession } from '../src/export.js';
import { validateBundleDir } from '../src/validate.js';
import type {
  SessionDataSource,
  SessionJson,
  SessionMeta,
  SnapshotRecord,
  StreamKey,
  StreamRecord,
  WebcamSegmentSource,
} from '../src/types.js';

const BASE = 1_717_400_000_000;

/** In-memory data source — no Postgres/MinIO needed to exercise the writer. */
class FixtureSource implements SessionDataSource {
  constructor(private readonly opts: { withScreenshot?: boolean; missingWebcam?: boolean } = {}) {}

  async getSessionMeta(sessionId: string): Promise<SessionMeta> {
    return {
      sessionId, userId: 'user-1', courseId: 'course-1', moduleId: 'mod-1',
      timezone: 'Asia/Kuala_Lumpur', startedAtMs: BASE, endedAtMs: BASE + 60_000, durationSecs: 60,
    };
  }
  async getSessionJson(sessionId: string): Promise<SessionJson> {
    return {
      session: { id: sessionId, userId: 'user-1', courseId: 'course-1', startedAt: new Date(BASE).toISOString(), endedAt: new Date(BASE + 60_000).toISOString(), durationSecs: 60, userAgent: 'jsdom', device: null },
      syncAnchor: { wallClockMs: BASE, monotonicMs: 1000, serverReceiveMs: BASE + 5, timezone: 'Asia/Kuala_Lumpur', userAgent: 'jsdom' },
      context: { userDisplayName: 'Test Student', courseTitle: 'Algebra', moduleTitle: null },
    };
  }
  async getSyncAnchorWallMs(): Promise<number | null> { return BASE; }
  async *getSnapshots(): AsyncIterable<SnapshotRecord> {
    yield {
      snapshotId: 'snap-1', wallMs: BASE + 1000, trigger: 'interval', pageUrl: 'http://x/lesson',
      width: 1280, height: 720, scrollX: 0, scrollY: 0,
      aois: [{ region: 'lesson', x: 0, y: 0, width: 800, height: 720 }],
      scrollHosts: [{ region: 'lesson', scrollTop: 100, scrollHeight: 2000, clientHeight: 700 }],
      pdfCurrentPage: null, pdfTotalPages: null,
      html: '<html><body><h1>Lesson</h1></body></html>',
      screenshotDataUrl: this.opts.withScreenshot
        ? 'data:image/jpeg;base64,' + Buffer.from('fakejpeg').toString('base64')
        : null,
    };
  }
  async getWebcamSegments(): Promise<WebcamSegmentSource[]> {
    return [{ segmentId: 'seg-1', startWallMs: BASE, endWallMs: BASE + 30_000, durationMs: 30_000, mimeType: 'video/webm', blobKey: 'recordings/seg-1.webm' }];
  }
  async getBlob(): Promise<Buffer | null> {
    return this.opts.missingWebcam ? null : Buffer.from('fakewebmbytes');
  }
  async *getStream(_s: string, key: StreamKey): AsyncIterable<StreamRecord> {
    if (key === 'webgazer') {
      for (let i = 0; i < 100; i++) yield { wallMs: BASE + i * 100, x: i, y: i * 2, confidence: 0.9 };
    } else if (key === 'clicks') {
      yield { wallMs: BASE + 5000, x: 10, y: 20, target: 'button', pageUrl: 'http://x/lesson' };
    } else if (key === 'emotion_frames') {
      yield { wallMs: BASE + 2000, frameIndex: 0, faceDetected: true, dominant: 'neutral', dominantProbability: 0.8, pNeutral: 0.8 };
    }
    // other streams empty
  }
}

const tmpDirs: string[] = [];
afterAll(async () => { for (const d of tmpDirs) await rm(d, { recursive: true, force: true }); });
async function tmp(): Promise<string> { const d = await mkdtemp(join(tmpdir(), 'gals-export-')); tmpDirs.push(d); return d; }

describe('exportSession', () => {
  it('produces a bundle that validates against the spec', async () => {
    const out = await tmp();
    const result = await exportSession(new FixtureSource({ withScreenshot: true }), {
      sessionId: 's1', outDir: out, exportedAt: '2026-06-03T00:00:00.000Z',
    });
    const report = await validateBundleDir(result.bundleDir);
    expect(report.errors).toEqual([]);
    expect(report.ok).toBe(true);
    expect(result.manifest.counts.webgazer).toBe(100);
    expect(result.manifest.counts.snapshots).toBe(1);
    expect(result.manifest.baseWallClockMs).toBe(BASE);
    // duration spans to the last webcam segment end (BASE + 30s).
    expect(result.manifest.durationMs).toBe(30_000);
  });

  it('refuses to overwrite without --force, reproduces identical bytes with it', async () => {
    const out = await tmp();
    const r1 = await exportSession(new FixtureSource(), { sessionId: 's1', outDir: out, exportedAt: 'FIXED' });
    await expect(
      exportSession(new FixtureSource(), { sessionId: 's1', outDir: out, exportedAt: 'FIXED' }),
    ).rejects.toThrow(/force/);
    const r2 = await exportSession(new FixtureSource(), { sessionId: 's1', outDir: out, exportedAt: 'FIXED', force: true });
    // Checksums identical (exportedAt held fixed) -> byte-identical bundle.
    expect(r2.manifest.files).toEqual(r1.manifest.files);
  });

  it('records missing webcam segments without aborting', async () => {
    const out = await tmp();
    const result = await exportSession(new FixtureSource({ missingWebcam: true }), {
      sessionId: 's1', outDir: out, exportedAt: 'FIXED',
    });
    expect(result.missingWebcamSegments).toEqual(['seg-1']);
    const idx = JSON.parse(await readFile(join(result.bundleDir, 'webcam/index.json'), 'utf8'));
    expect(idx[0].status).toBe('missing');
    const report = await validateBundleDir(result.bundleDir);
    expect(report.ok).toBe(true);
  });

  it('omits optional empty files (no probes when none exist)', async () => {
    const out = await tmp();
    const result = await exportSession(new FixtureSource(), { sessionId: 's1', outDir: out, exportedAt: 'FIXED' });
    expect(result.manifest.files['probes/probes.jsonl']).toBeUndefined();
    expect(result.manifest.files['streams/clicks.jsonl']).toBeDefined();
  });
});
