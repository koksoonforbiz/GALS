import { mkdir, copyFile, rm, stat } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { tmpdir } from 'node:os';
import AdmZip from 'adm-zip';
import {
  validateBundle,
  readStreamRecords,
  WINDOW_MS,
  windowId,
  windowCount,
  DEFAULT_CODEBOOK,
  scoreInstrument,
  type StreamKey,
  type BundleValidationReport,
} from '@gals-studio/shared';
import { prisma } from '../prisma.js';
import { mediaDirFor } from '../config.js';

const BATCH = 2000;

export interface ImportReport {
  ok: boolean;
  sessionId?: string;
  errors: string[];
  warnings: string[];
  inserted: Record<string, number>;
  windows: number;
  missingWebcam: string[];
  checksumMismatches: string[];
  validation?: BundleValidationReport;
}

const n = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const i = (v: unknown): number | null => (n(v) == null ? null : Math.trunc(v as number));
const s = (v: unknown): string | null => (typeof v === 'string' ? v : null);
/** SQLite has no JSON type — JSON-bearing columns are stringified. */
const J = (v: unknown): string | null => (v == null ? null : JSON.stringify(v));

/** Ensure the default codebook version exists (seeded once, never overwritten). */
export async function ensureDefaultCodebook(): Promise<string> {
  const existing = await prisma.codebookVersion.findFirst({
    where: { name: DEFAULT_CODEBOOK.name, version: DEFAULT_CODEBOOK.version },
  });
  if (existing) return existing.id;
  const created = await prisma.codebookVersion.create({
    data: {
      name: DEFAULT_CODEBOOK.name,
      version: DEFAULT_CODEBOOK.version,
      definition: JSON.stringify(DEFAULT_CODEBOOK),
      locked: false,
    },
  });
  return created.id;
}

/** Resolve a bundle path: unzip a .zip to a temp dir, else use the folder. */
async function resolveBundleDir(path: string): Promise<{ dir: string; cleanup?: () => Promise<void> }> {
  if (path.toLowerCase().endsWith('.zip')) {
    const out = join(tmpdir(), `gals-import-${Date.now()}-${basename(path, '.zip')}`);
    new AdmZip(path).extractAllTo(out, true);
    // a bundle zip may contain a single session_<id>/ folder
    const fs = await import('node:fs/promises');
    const entries = await fs.readdir(out, { withFileTypes: true });
    const dirs = entries.filter((e) => e.isDirectory());
    const hasManifestAtRoot = entries.some((e) => e.isFile() && e.name === 'manifest.json');
    const dir = !hasManifestAtRoot && dirs.length === 1 ? join(out, dirs[0].name) : out;
    return { dir, cleanup: () => rm(out, { recursive: true, force: true }) };
  }
  return { dir: path };
}

/**
 * Import one bundle (folder or zip) into SQLite + on-disk media.
 * Idempotent: re-importing a sessionId deletes ONLY that session's ingested
 * stream/media rows and reinserts; coding tables (Coder, Annotation,
 * CodebookVersion, ReliabilityRun) are never touched.
 */
export async function importBundle(path: string): Promise<ImportReport> {
  const report: ImportReport = {
    ok: false,
    errors: [],
    warnings: [],
    inserted: {},
    windows: 0,
    missingWebcam: [],
    checksumMismatches: [],
  };

  const { dir, cleanup } = await resolveBundleDir(path);
  try {
    const v = await validateBundle(dir);
    report.validation = v;
    report.warnings.push(...v.warnings);
    report.checksumMismatches = v.checksumMismatches;
    report.missingWebcam = v.missingWebcam;
    if (!v.ok || !v.manifest || !v.session) {
      report.errors.push(...v.errors);
      return report;
    }
    const m = v.manifest;
    const sessionId = m.sessionId;
    report.sessionId = sessionId;

    await ensureDefaultCodebook();

    // ── Idempotent refresh: wipe only this session's ingested rows + media ──
    // Cascade delete from Session removes all stream/snapshot/webcam/window
    // rows; coding tables key off sessionId/windowId by string and are NOT
    // FK-bound to Session, so they survive.
    await prisma.session.deleteMany({ where: { id: sessionId } });
    const media = mediaDirFor(sessionId);
    await rm(media, { recursive: true, force: true });
    await mkdir(join(media, 'snapshots'), { recursive: true });
    await mkdir(join(media, 'webcam'), { recursive: true });

    // ── Session row ──────────────────────────────────────────────────────
    const sj = v.session.session;
    await prisma.session.create({
      data: {
        id: sessionId,
        userId: m.userId,
        courseId: m.courseId,
        moduleId: m.moduleId ?? null,
        startedAt: new Date(sj.startedAt),
        endedAt: sj.endedAt ? new Date(sj.endedAt) : null,
        durationMs: Math.trunc(m.durationMs),
        timezone: m.timezone,
        baseWallClockMs: m.baseWallClockMs,
        device: sj.device ?? null,
        bundleVersion: m.bundleVersion,
        manifest: JSON.stringify(m),
        mediaDir: sessionId,
        userDisplayName: v.session.context.userDisplayName ?? null,
        courseTitle: v.session.context.courseTitle ?? null,
        moduleTitle: v.session.context.moduleTitle ?? null,
      },
    });

    // ── Snapshots: copy html/jpg, insert rows ──────────────────────────────
    if (v.snapshots) {
      const rows = [];
      for (const snap of v.snapshots) {
        const srcHtml = join(dir, 'snapshots', snap.htmlFile);
        const dstHtml = join(media, 'snapshots', snap.htmlFile);
        if (existsSync(srcHtml)) await copyFile(srcHtml, dstHtml);
        let screenshotPath: string | null = null;
        if (snap.screenshotFile) {
          const srcJpg = join(dir, 'snapshots', snap.screenshotFile);
          if (existsSync(srcJpg)) {
            await copyFile(srcJpg, join(media, 'snapshots', snap.screenshotFile));
            screenshotPath = join(sessionId, 'snapshots', snap.screenshotFile);
          }
        }
        rows.push({
          id: snap.snapshotId,
          sessionId,
          wallMs: snap.wallMs,
          trigger: snap.trigger,
          pageUrl: snap.pageUrl,
          width: snap.width,
          height: snap.height,
          scrollX: snap.scrollX,
          scrollY: snap.scrollY,
          aois: J(snap.aois),
          scrollHosts: J(snap.scrollHosts),
          pdfCurrentPage: snap.pdfCurrentPage,
          pdfTotalPages: snap.pdfTotalPages,
          htmlPath: join(sessionId, 'snapshots', snap.htmlFile),
          screenshotPath,
        });
      }
      for (let k = 0; k < rows.length; k += BATCH) {
        await prisma.snapshot.createMany({ data: rows.slice(k, k + BATCH) });
      }
      report.inserted.snapshots = rows.length;
    }

    // ── Webcam: copy mp4/webm, insert rows ──────────────────────────────────
    if (v.webcam) {
      const rows = [];
      for (const seg of v.webcam) {
        let mp4Path: string | null = null;
        if (seg.status === 'ok') {
          const src = join(dir, 'webcam', seg.file);
          if (existsSync(src)) {
            await copyFile(src, join(media, 'webcam', seg.file));
            mp4Path = join(sessionId, 'webcam', seg.file);
          }
        }
        rows.push({
          id: seg.segmentId,
          sessionId,
          startWallMs: seg.startWallMs,
          endWallMs: seg.endWallMs,
          mp4Path,
          byteSize: seg.byteSize,
          status: seg.status,
          mimeType: seg.mimeType ?? null,
        });
      }
      await prisma.webcamSegment.createMany({ data: rows });
      report.inserted.webcam = rows.length;
    }

    // ── Streams ─────────────────────────────────────────────────────────────
    for (const key of Object.keys(streamInserters) as StreamKey[]) {
      if (!m.files[streamFile(key)]) continue;
      try {
        const count = await streamInserters[key](dir, sessionId);
        if (count > 0) report.inserted[key] = count;
      } catch (err) {
        report.warnings.push(`${key}: insert failed — ${(err as Error).message}`);
      }
    }

    // ── Coding windows ──────────────────────────────────────────────────────
    const count = windowCount(m.durationMs);
    const winRows = [];
    for (let idx = 0; idx < count; idx++) {
      const start = m.baseWallClockMs + idx * WINDOW_MS;
      const end = Math.min(m.baseWallClockMs + (idx + 1) * WINDOW_MS, m.baseWallClockMs + m.durationMs);
      winRows.push({
        id: windowId(sessionId, idx),
        sessionId,
        index: idx,
        startWallMs: start,
        endWallMs: end,
        durationMs: Math.trunc(end - start),
      });
    }
    for (let k = 0; k < winRows.length; k += BATCH) {
      await prisma.codingWindow.createMany({ data: winRows.slice(k, k + BATCH) });
    }
    report.windows = winRows.length;

    report.ok = true;
    return report;
  } catch (err) {
    report.errors.push((err as Error).message);
    // best-effort rollback of a half-imported session
    if (report.sessionId) {
      await prisma.session.deleteMany({ where: { id: report.sessionId } }).catch(() => {});
    }
    return report;
  } finally {
    await cleanup?.();
  }
}

function streamFile(key: StreamKey): string {
  // mirrors STREAM_FILES; kept local to avoid importing the const map twice
  const map: Record<StreamKey, string> = {
    webgazer: 'streams/webgazer.jsonl', pupil: 'streams/pupil.jsonl',
    emotion_frames: 'streams/emotion_frames.jsonl', au_results: 'streams/au_results.jsonl',
    clicks: 'streams/clicks.jsonl', scrolls: 'streams/scrolls.jsonl',
    cursors: 'streams/cursors.jsonl', keystrokes: 'streams/keystrokes.jsonl',
    clipboard: 'streams/clipboard.jsonl', visibility: 'streams/visibility.jsonl',
    viewport: 'streams/viewport.jsonl', activity: 'streams/activity.jsonl',
    chatbot: 'messages/chatbot.jsonl', dialogue: 'messages/dialogue.jsonl',
    interventions: 'messages/interventions.jsonl', ef_detections: 'messages/ef_detections.jsonl',
    mastery: 'kc/mastery.jsonl', cards: 'kc/cards.jsonl', attempts: 'kc/attempts.jsonl',
    probes: 'probes/probes.jsonl', questionnaires: 'questionnaires/questionnaires.jsonl',
    annotations: 'annotations/annotations.jsonl', codes: 'annotations/codes.jsonl',
  };
  return map[key];
}

/** Generic batched insert helper over a stream's mapped rows. */
async function insertStream<T>(
  dir: string,
  key: StreamKey,
  map: (r: Record<string, unknown>) => T | null,
  create: (rows: T[]) => Promise<unknown>,
): Promise<number> {
  let buf: T[] = [];
  let total = 0;
  for await (const rec of readStreamRecords(dir, key)) {
    const mapped = map(rec);
    if (mapped == null) continue;
    buf.push(mapped);
    if (buf.length >= BATCH) {
      await create(buf);
      total += buf.length;
      buf = [];
    }
  }
  if (buf.length) {
    await create(buf);
    total += buf.length;
  }
  return total;
}

const streamInserters: Record<StreamKey, (dir: string, sessionId: string) => Promise<number>> = {
  webgazer: (d, sid) => insertStream(d, 'webgazer',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, x: n(r.x) ?? 0, y: n(r.y) ?? 0, confidence: n(r.confidence) }),
    (rows) => prisma.gazeSample.createMany({ data: rows as never })),
  pupil: (d, sid) => insertStream(d, 'pupil',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, diameter: n(r.diameter) ?? 0 }),
    (rows) => prisma.pupilSample.createMany({ data: rows as never })),
  emotion_frames: (d, sid) => insertStream(d, 'emotion_frames',
    (r) => (n(r.wallMs) == null ? null : {
      sessionId: sid, wallMs: r.wallMs as number, faceDetected: !!r.faceDetected,
      dominant: s(r.dominant), dominantProbability: n(r.dominantProbability),
      pHappiness: n(r.pHappiness), pSadness: n(r.pSadness), pSurprise: n(r.pSurprise),
      pFear: n(r.pFear), pAnger: n(r.pAnger), pDisgust: n(r.pDisgust),
      pContempt: n(r.pContempt), pNeutral: n(r.pNeutral),
    }),
    (rows) => prisma.emotionFrame.createMany({ data: rows as never })),
  au_results: (d, sid) => insertStream(d, 'au_results',
    (r) => {
      if (n(r.wallMs) == null) return null;
      const aus: Record<string, number> = {};
      for (const [k, val] of Object.entries(r)) if (/^au\d+$/.test(k) && typeof val === 'number') aus[k] = val;
      return { sessionId: sid, wallMs: r.wallMs as number, faceConf: n(r.faceConf), aus };
    },
    (rows) => prisma.auResult.createMany({ data: rows as never })),
  clicks: (d, sid) => insertStream(d, 'clicks',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, x: n(r.x) ?? 0, y: n(r.y) ?? 0, target: s(r.target), pageUrl: s(r.pageUrl) }),
    (rows) => prisma.click.createMany({ data: rows as never })),
  scrolls: (d, sid) => insertStream(d, 'scrolls',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, scrollY: n(r.scrollY), scrollPercent: n(r.scrollPercent), pageUrl: s(r.pageUrl), scrollHosts: J(r.scrollHosts) }),
    (rows) => prisma.scroll.createMany({ data: rows as never })),
  cursors: (d, sid) => insertStream(d, 'cursors',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, x: n(r.x) ?? 0, y: n(r.y) ?? 0, target: s(r.target) }),
    (rows) => prisma.cursor.createMany({ data: rows as never })),
  keystrokes: (d, sid) => insertStream(d, 'keystrokes',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, fieldId: s(r.fieldId), keystrokeCount: i(r.keystrokeCount), pauseDurationMs: i(r.pauseDurationMs), typingSpeedWPM: n(r.typingSpeedWPM) }),
    (rows) => prisma.keystroke.createMany({ data: rows as never })),
  clipboard: (d, sid) => insertStream(d, 'clipboard',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, action: s(r.action), textLength: i(r.textLength), sourceElement: s(r.sourceElement) }),
    (rows) => prisma.clipboard.createMany({ data: rows as never })),
  visibility: (d, sid) => insertStream(d, 'visibility',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, visibleState: s(r.visibleState), hiddenDurationMs: i(r.hiddenDurationMs) }),
    (rows) => prisma.visibility.createMany({ data: rows as never })),
  viewport: (d, sid) => insertStream(d, 'viewport',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, width: i(r.width), height: i(r.height), orientation: s(r.orientation) }),
    (rows) => prisma.viewport.createMany({ data: rows as never })),
  activity: (d, sid) => insertStream(d, 'activity',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, action: s(r.action) ?? 'unknown', metadata: J(r.metadata), interventionId: s(r.interventionId), dialogueSessionId: s(r.dialogueSessionId), moduleItemId: s(r.moduleItemId) }),
    (rows) => prisma.activityEvent.createMany({ data: rows as never })),
  chatbot: (d, sid) => insertStream(d, 'chatbot',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, role: s(r.role) ?? 'unknown', content: s(r.content) ?? '', selectedText: s(r.selectedText), model: s(r.model) }),
    (rows) => prisma.chatbotMessage.createMany({ data: rows as never })),
  dialogue: (d, sid) => insertStream(d, 'dialogue',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, role: s(r.role) ?? 'unknown', content: s(r.content) ?? '', dialogueSessionId: s(r.dialogueSessionId) }),
    (rows) => prisma.dialogueMessage.createMany({ data: rows as never })),
  interventions: (d, sid) => insertStream(d, 'interventions',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, externalId: s(r.id), type: s(r.type), status: s(r.status), sessionData: J(r.sessionData), selectedText: s(r.selectedText) }),
    (rows) => prisma.intervention.createMany({ data: rows as never })),
  ef_detections: (d, sid) => insertStream(d, 'ef_detections',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, construct: s(r.construct) ?? 'unknown', label: s(r.label) ?? '', confidence: n(r.confidence), severity: s(r.severity), rationale: s(r.rationale), sourceRef: s(r.messageId) }),
    (rows) => prisma.efDetection.createMany({ data: rows as never })),
  mastery: (d, sid) => insertStream(d, 'mastery',
    (r) => ({ sessionId: sid, wallMs: n(r.wallMs) ?? 0, data: JSON.stringify(r) }),
    (rows) => prisma.mastery.createMany({ data: rows as never })),
  cards: (d, sid) => insertStream(d, 'cards',
    (r) => ({ sessionId: sid, wallMs: n(r.wallMs) ?? 0, data: JSON.stringify(r) }),
    (rows) => prisma.spacedRepCard.createMany({ data: rows as never })),
  attempts: (d, sid) => insertStream(d, 'attempts',
    (r) => ({ sessionId: sid, wallMs: n(r.wallMs) ?? 0, data: JSON.stringify(r) }),
    (rows) => prisma.attempt.createMany({ data: rows as never })),
  probes: (d, sid) => insertStream(d, 'probes',
    (r) => (n(r.wallMs) == null ? null : { sessionId: sid, wallMs: r.wallMs as number, probeType: s(r.probeType) ?? 'unknown', items: JSON.stringify(r.items ?? {}), latencyMs: i(r.latencyMs), scheduledWallMs: n(r.scheduledWallMs), shownWallMs: n(r.shownWallMs), completed: r.completed !== false }),
    (rows) => prisma.probeResponse.createMany({ data: rows as never })),
  questionnaires: (d, sid) => insertStream(d, 'questionnaires',
    (r) => {
      const instrument = s(r.instrument) ?? 'unknown';
      // Score subscales on import when not already provided (published keys).
      let scored = r.scoredSubscales;
      if (scored == null && r.items && typeof r.items === 'object') {
        const result = scoreInstrument(instrument, r.items as Record<string, number>);
        if (result) scored = result.subscales;
      }
      return { sessionId: sid, userId: s(r.userId), instrument, phase: s(r.phase) ?? 'post', items: JSON.stringify(r.items ?? {}), scoredSubscales: J(scored), completedAt: r.completedAt ? new Date(r.completedAt as string) : null };
    },
    (rows) => prisma.questionnaire.createMany({ data: rows as never })),
  annotations: (d, sid) => insertStream(d, 'annotations',
    (r) => ({ sessionId: sid, externalId: s(r.id), startMs: n(r.startMs) ?? 0, endMs: n(r.endMs), note: s(r.note), codeId: s(r.codeId), researcherId: s(r.researcherId) }),
    (rows) => prisma.carriedAnnotation.createMany({ data: rows as never })),
  // `codes` are reference label definitions; the simplest durable home is to
  // leave them embedded on the carried annotations' codeId (resolved in the UI).
  codes: async () => 0,
};
