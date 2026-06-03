import { access, rm, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { BundleWriter } from './writer.js';
import {
  BUNDLE_VERSION,
  EXPORTER_VERSION,
  LARGE_STREAMS,
  OPTIONAL_STREAMS,
  STREAM_FILES,
  type BundleManifest,
  type ExportOptions,
  type ExportResult,
  type SessionDataSource,
  type StreamKey,
  type StreamRecord,
} from './types.js';

const mimeExt: Record<string, string> = {
  'video/webm': 'webm',
  'video/mp4': 'mp4',
  'video/quicktime': 'mov',
};

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

/** Tap an async iterable to track the max finite `wallMs` seen. */
async function* trackMaxWall(
  src: AsyncIterable<StreamRecord>,
  state: { max: number },
): AsyncIterable<StreamRecord> {
  for await (const row of src) {
    if (typeof row.wallMs === 'number' && Number.isFinite(row.wallMs) && row.wallMs > state.max) {
      state.max = row.wallMs;
    }
    yield row;
  }
}

/**
 * Export one session to a bundle folder (and optionally a zip). Pure with
 * respect to the injected data source — see SessionDataSource.
 */
export async function exportSession(
  ds: SessionDataSource,
  opts: ExportOptions,
): Promise<ExportResult> {
  const log = opts.log ?? (() => {});
  const { sessionId } = opts;
  const bundleDir = join(opts.outDir, `session_${sessionId}`);

  if (await exists(bundleDir)) {
    if (!opts.force) {
      throw new Error(
        `Refusing to overwrite existing bundle at ${bundleDir} — pass --force to reproduce it.`,
      );
    }
    await rm(bundleDir, { recursive: true, force: true });
  }

  const meta = await ds.getSessionMeta(sessionId);
  const writer = new BundleWriter(bundleDir);
  const counts: Record<string, number> = {};
  const notes: string[] = [];
  const wallState = { max: 0 };

  // ── Snapshots: write html/jpg verbatim, build the ordered index ──────────
  const snapIndex: Array<Record<string, unknown>> = [];
  try {
    for await (const s of ds.getSnapshots(sessionId)) {
      const htmlFile = `${s.snapshotId}.html`;
      await writer.writeFileTracked(`snapshots/${htmlFile}`, s.html ?? '');
      let screenshotFile: string | undefined;
      if (s.screenshotDataUrl) {
        const b64 = s.screenshotDataUrl.replace(/^data:image\/[a-zA-Z]+;base64,/, '');
        try {
          const jpg = Buffer.from(b64, 'base64');
          screenshotFile = `${s.snapshotId}.jpg`;
          await writer.writeFileTracked(`snapshots/${screenshotFile}`, jpg);
        } catch {
          notes.push(`snapshot ${s.snapshotId}: screenshot decode failed, skipped`);
        }
      }
      if (Number.isFinite(s.wallMs) && s.wallMs > wallState.max) wallState.max = s.wallMs;
      snapIndex.push({
        snapshotId: s.snapshotId,
        wallMs: s.wallMs,
        trigger: s.trigger,
        pageUrl: s.pageUrl,
        width: s.width,
        height: s.height,
        scrollX: s.scrollX,
        scrollY: s.scrollY,
        aois: s.aois ?? null,
        scrollHosts: s.scrollHosts ?? null,
        pdfCurrentPage: s.pdfCurrentPage ?? null,
        pdfTotalPages: s.pdfTotalPages ?? null,
        htmlFile,
        ...(screenshotFile ? { screenshotFile } : {}),
      });
    }
  } catch (err) {
    notes.push(`snapshots: partial export — ${(err as Error).message}`);
  }
  snapIndex.sort((a, b) => (a.wallMs as number) - (b.wallMs as number));
  await writer.writeFileTracked('snapshots/index.json', JSON.stringify(snapIndex, null, 2));
  counts.snapshots = snapIndex.length;
  log(`snapshots: ${snapIndex.length}`);

  // ── The time anchor ──────────────────────────────────────────────────────
  const syncAnchorMs = await ds.getSyncAnchorWallMs(sessionId).catch(() => null);
  const firstSnapMs = snapIndex.length ? (snapIndex[0].wallMs as number) : null;
  const candidates = [syncAnchorMs, firstSnapMs, meta.startedAtMs].filter(
    (n): n is number => typeof n === 'number' && Number.isFinite(n),
  );
  const baseWallClockMs = candidates.length ? Math.min(...candidates) : meta.startedAtMs;

  // ── Streams (JSONL) — one bad stream never aborts the whole export ───────
  for (const key of Object.keys(STREAM_FILES) as StreamKey[]) {
    const rel = STREAM_FILES[key];
    try {
      const tapped = trackMaxWall(ds.getStream(sessionId, key), wallState);
      const n = await writer.writeJsonl(rel, tapped);
      counts[key] = n;
      if (n === 0 && OPTIONAL_STREAMS.includes(key)) {
        // Optional + empty: drop the file from the bundle entirely.
        await rm(join(bundleDir, rel), { force: true });
        delete writer.files[rel];
      }
      if (LARGE_STREAMS.includes(key)) log(`${key}: ${n} rows`);
    } catch (err) {
      counts[key] = 0;
      notes.push(`${key}: fetch failed (${(err as Error).message}); wrote empty file`);
      if (!OPTIONAL_STREAMS.includes(key)) {
        await writer.writeFileTracked(rel, '');
      }
    }
  }

  // ── Webcam segments ──────────────────────────────────────────────────────
  const missingWebcamSegments: string[] = [];
  const webcamIndex: Array<Record<string, unknown>> = [];
  if (opts.includeWebcam !== false) {
    let segments: Awaited<ReturnType<SessionDataSource['getWebcamSegments']>> = [];
    try {
      segments = await ds.getWebcamSegments(sessionId);
    } catch (err) {
      notes.push(`webcam: segment list failed (${(err as Error).message})`);
    }
    for (const seg of segments) {
      const ext = mimeExt[seg.mimeType] ?? 'webm';
      const file = `${seg.segmentId}.${ext}`;
      let status: 'ok' | 'missing' = 'missing';
      let byteSize = 0;
      try {
        const bytes = await ds.getBlob(seg.blobKey);
        if (bytes && bytes.byteLength > 0) {
          await writer.writeFileTracked(`webcam/${file}`, bytes);
          byteSize = bytes.byteLength;
          status = 'ok';
        }
      } catch {
        /* fall through to missing */
      }
      if (status === 'missing') {
        missingWebcamSegments.push(seg.segmentId);
        notes.push(`webcam segment ${seg.segmentId} missing in blob storage — status:missing`);
      }
      const endWallMs = seg.endWallMs ?? (seg.durationMs ? seg.startWallMs + seg.durationMs : null);
      if (typeof endWallMs === 'number' && endWallMs > wallState.max) wallState.max = endWallMs;
      webcamIndex.push({
        segmentId: seg.segmentId,
        startWallMs: seg.startWallMs,
        endWallMs,
        file,
        byteSize,
        status,
        mimeType: seg.mimeType,
        durationMs: seg.durationMs ?? null,
      });
    }
  }
  await writer.writeFileTracked('webcam/index.json', JSON.stringify(webcamIndex, null, 2));
  counts.webcam = webcamIndex.length;

  // ── session.json ─────────────────────────────────────────────────────────
  const sessionJson = await ds.getSessionJson(sessionId);
  await writer.writeFileTracked('session.json', JSON.stringify(sessionJson, null, 2));

  // ── Duration ─────────────────────────────────────────────────────────────
  let durationMs = wallState.max > baseWallClockMs ? wallState.max - baseWallClockMs : 0;
  if (durationMs === 0 && meta.durationSecs) durationMs = meta.durationSecs * 1000;
  if (durationMs === 0 && meta.endedAtMs) durationMs = Math.max(0, meta.endedAtMs - baseWallClockMs);

  // ── manifest.json (written last; cannot checksum itself) ─────────────────
  const manifest: BundleManifest = {
    bundleVersion: BUNDLE_VERSION,
    exporterVersion: EXPORTER_VERSION,
    exportedAt: opts.exportedAt ?? new Date().toISOString(),
    sessionId: meta.sessionId,
    userId: meta.userId,
    courseId: meta.courseId,
    ...(meta.moduleId ? { moduleId: meta.moduleId } : {}),
    timezone: meta.timezone,
    baseWallClockMs,
    durationMs,
    counts,
    files: writer.files,
    notes,
  };
  // manifest.json is written last, so `writer.files` already holds every other
  // file and never lists the manifest itself.
  await writer.writeFileTracked('manifest.json', JSON.stringify(manifest, null, 2));

  let zipPath: string | undefined;
  if (opts.zip) {
    zipPath = join(opts.outDir, `session_${sessionId}.zip`);
    await writer.zipTo(zipPath);
    log(`zip: ${zipPath}`);
  }

  return { bundleDir, zipPath, manifest, missingWebcamSegments };
}

/** Convenience: total bytes written (for the CLI summary). */
export async function bundleByteSize(bundleDir: string): Promise<number> {
  let total = 0;
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, entry.name);
      if (entry.isDirectory()) await walk(p);
      else {
        const { stat } = await import('node:fs/promises');
        total += (await stat(p)).size;
      }
    }
  };
  await walk(bundleDir);
  return total;
}
