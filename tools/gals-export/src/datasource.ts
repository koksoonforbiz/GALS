/**
 * Prisma + S3/MinIO backed implementation of SessionDataSource.
 *
 * Imports `@prisma/client` from the live GALS monorepo so the exporter reuses
 * the existing schema/types. Run `pnpm db:generate` once before exporting.
 * Connects directly to Postgres — the Nest app does NOT need to be running.
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import type {
  SessionDataSource,
  SessionJson,
  SessionMeta,
  SnapshotRecord,
  StreamKey,
  StreamRecord,
  WebcamSegmentSource,
} from './types.js';

const BATCH = 5000;
const AU_KEYS = [
  'au01',
  'au02',
  'au04',
  'au05',
  'au06',
  'au07',
  'au09',
  'au10',
  'au12',
  'au14',
  'au15',
  'au17',
  'au20',
  'au23',
  'au24',
  'au25',
  'au26',
  'au28',
] as const;

const num = (v: bigint | number | null | undefined): number =>
  typeof v === 'bigint' ? Number(v) : typeof v === 'number' ? v : 0;
const dateMs = (d: Date | null | undefined): number | null => (d ? d.getTime() : null);

export interface PrismaLike {
  studentSession: any;
  session_sync_anchors: any;
  sessionReplaySnapshot: any;
  recordingSegment: any;
  webgazerLog: any;
  pupilSizeLog: any;
  emotionFrame: any;
  pyfeatAuResult: any;
  click_logs: any;
  scroll_logs: any;
  cursor_logs: any;
  keystroke_logs: any;
  clipboard_logs: any;
  visibility_logs: any;
  viewport_logs: any;
  activityLog: any;
  chatbotMessage: any;
  dialogueMessage: any;
  learningIntervention: any;
  efDetection: any;
  userMastery: any;
  spacedRepetitionCard: any;
  attempt: any;
  user: any;
  course: any;
  $disconnect?: () => Promise<void>;
}

export class PrismaDataSource implements SessionDataSource {
  constructor(
    private readonly prisma: PrismaLike,
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async getSessionMeta(sessionId: string): Promise<SessionMeta> {
    const s = await this.prisma.studentSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new Error(`Session ${sessionId} not found`);
    const anchor = await this.prisma.session_sync_anchors.findUnique({ where: { sessionId } });
    const lastActivity = await this.prisma.activityLog.findFirst({
      where: { sessionId, moduleId: { not: null } },
      orderBy: { occurredAt: 'desc' },
      select: { moduleId: true },
    });
    return {
      sessionId: s.id,
      userId: s.userId,
      courseId: s.courseId ?? '',
      moduleId: lastActivity?.moduleId ?? undefined,
      timezone: anchor?.timezone ?? 'UTC',
      startedAtMs: s.startedAt.getTime(),
      endedAtMs: dateMs(s.endedAt),
      durationSecs: s.durationSecs ?? null,
    };
  }

  async getSessionJson(sessionId: string): Promise<SessionJson> {
    const s = await this.prisma.studentSession.findUnique({ where: { id: sessionId } });
    if (!s) throw new Error(`Session ${sessionId} not found`);
    const anchor = await this.prisma.session_sync_anchors.findUnique({ where: { sessionId } });
    const user = await this.prisma.user
      .findUnique({ where: { id: s.userId }, select: { name: true } })
      .catch(() => null);
    const course = s.courseId
      ? await this.prisma.course
          .findUnique({ where: { id: s.courseId }, select: { title: true } })
          .catch(() => null)
      : null;
    return {
      session: {
        id: s.id,
        userId: s.userId,
        courseId: s.courseId ?? '',
        startedAt: s.startedAt.toISOString(),
        endedAt: s.endedAt ? s.endedAt.toISOString() : null,
        durationSecs: s.durationSecs ?? null,
        userAgent: s.userAgent ?? null,
        device: null,
      },
      syncAnchor: anchor
        ? {
            wallClockMs: num(anchor.wallClockMs),
            monotonicMs: num(anchor.monotonicMs),
            serverReceiveMs: num(anchor.serverReceiveMs),
            timezone: anchor.timezone ?? null,
            userAgent: anchor.userAgent ?? null,
          }
        : null,
      context: {
        userDisplayName: user?.name ?? null,
        courseTitle: course?.title ?? null,
        moduleTitle: null,
      },
    };
  }

  async getSyncAnchorWallMs(sessionId: string): Promise<number | null> {
    const a = await this.prisma.session_sync_anchors.findUnique({ where: { sessionId } });
    return a ? num(a.wallClockMs) : null;
  }

  async *getSnapshots(sessionId: string): AsyncIterable<SnapshotRecord> {
    const toRecord = (r: any): SnapshotRecord => ({
      snapshotId: r.id,
      wallMs: num(r.capturedAt),
      trigger: r.trigger,
      pageUrl: r.pageUrl,
      width: r.width,
      height: r.height,
      scrollX: r.scrollX,
      scrollY: r.scrollY,
      aois: r.aois ?? null,
      scrollHosts: r.scrollHosts ?? null,
      pdfCurrentPage: r.pdfCurrentPage ?? null,
      pdfTotalPages: r.pdfTotalPages ?? null,
      html: r.html ?? '',
      screenshotDataUrl: r.screenshotDataUrl ?? null,
    });

    // Page over ids first (cheap — no html/screenshot payload). A single row
    // whose html holds bytes the Prisma engine can't convert to a JS string
    // ("Failed to convert rust String into napi string") otherwise throws for
    // the whole page and silently truncates the export. So on a page error we
    // fall back to per-row reads and skip only the offending snapshot.
    const ids = (
      await this.prisma.sessionReplaySnapshot.findMany({
        where: { sessionId },
        orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      })
    ).map((r: any) => r.id as string);

    for (let i = 0; i < ids.length; i += 200) {
      const pageIds = ids.slice(i, i + 200);
      let rows: any[];
      try {
        rows = await this.prisma.sessionReplaySnapshot.findMany({
          where: { id: { in: pageIds } },
          orderBy: [{ capturedAt: 'asc' }, { id: 'asc' }],
        });
      } catch {
        rows = [];
        for (const id of pageIds) {
          try {
            const r = await this.prisma.sessionReplaySnapshot.findUnique({ where: { id } });
            if (r) rows.push(r);
          } catch {
            /* unconvertible row — skip it, keep the rest of the page */
          }
        }
      }
      for (const r of rows) yield toRecord(r);
    }
  }

  async getWebcamSegments(sessionId: string): Promise<WebcamSegmentSource[]> {
    const segs = await this.prisma.recordingSegment.findMany({
      where: { sessionId },
      orderBy: { startWallTime: 'asc' },
    });
    return segs.map((seg: any) => ({
      segmentId: seg.id,
      startWallMs: seg.startWallTime.getTime(),
      endWallMs: dateMs(seg.endWallTime),
      durationMs: seg.durationMs ?? null,
      mimeType: seg.mimeType ?? 'video/webm',
      blobKey: seg.minioKey,
    }));
  }

  async getBlob(blobKey: string): Promise<Buffer | null> {
    try {
      const res = await this.s3.send(new GetObjectCommand({ Bucket: this.bucket, Key: blobKey }));
      if (!res.Body) return null;
      const bytes = await (res.Body as any).transformToByteArray();
      return Buffer.from(bytes);
    } catch {
      return null;
    }
  }

  async *getStream(sessionId: string, key: StreamKey): AsyncIterable<StreamRecord> {
    switch (key) {
      case 'webgazer':
        yield* this.batched(this.prisma.webgazerLog, sessionId, 'timestamp', (r) => ({
          wallMs: r.timestamp.getTime(),
          x: r.gazeX,
          y: r.gazeY,
          confidence: r.confidence ?? null,
          pageUrl: r.pageUrl ?? null,
        }));
        return;
      case 'pupil':
        yield* this.batched(this.prisma.pupilSizeLog, sessionId, 'timestamp', (r) => ({
          wallMs: r.timestamp.getTime(),
          diameter: r.pupilDiameter,
        }));
        return;
      case 'emotion_frames':
        yield* this.batched(this.prisma.emotionFrame, sessionId, 'frameWallMs', (r) => ({
          wallMs: num(r.frameWallMs),
          frameIndex: r.frameIndex,
          faceDetected: r.faceDetected,
          dominant: r.dominantEmotion ?? null,
          dominantProbability: r.dominantProbability ?? null,
          pHappiness: r.pHappiness,
          pSadness: r.pSadness,
          pSurprise: r.pSurprise,
          pFear: r.pFear,
          pAnger: r.pAnger,
          pDisgust: r.pDisgust,
          pContempt: r.pContempt,
          pNeutral: r.pNeutral,
          headPoseYaw: r.headPoseYaw ?? null,
          headPosePitch: r.headPosePitch ?? null,
          headPoseRoll: r.headPoseRoll ?? null,
        }));
        return;
      case 'au_results': {
        let skip = 0;
        for (;;) {
          const rows = await this.prisma.pyfeatAuResult.findMany({
            where: { job: { sessionId } },
            orderBy: { wallTime: 'asc' },
            skip,
            take: BATCH,
          });
          if (rows.length === 0) break;
          for (const r of rows) {
            const aus: Record<string, number> = {};
            for (const k of AU_KEYS) if (r[k] != null) aus[k] = r[k];
            yield {
              wallMs: r.wallTime.getTime(),
              frameIndex: r.frameIndex,
              faceConf: r.faceConf ?? null,
              ...aus,
            };
          }
          skip += rows.length;
          if (rows.length < BATCH) break;
        }
        return;
      }
      case 'clicks':
        yield* this.batched(this.prisma.click_logs, sessionId, 'timestamp', (r) => ({
          wallMs: num(r.timestamp),
          x: r.x,
          y: r.y,
          target: r.elementSelector ?? null,
          text: r.elementText ?? null,
          pageUrl: r.pageUrl,
        }));
        return;
      case 'scrolls':
        yield* this.batched(this.prisma.scroll_logs, sessionId, 'timestamp', (r) => ({
          wallMs: num(r.timestamp),
          scrollY: r.scrollY,
          scrollPercent: r.scrollPercent,
          pageUrl: r.pageUrl,
        }));
        return;
      case 'cursors':
        yield* this.batched(this.prisma.cursor_logs, sessionId, 'timestamp', (r) => ({
          wallMs: num(r.timestamp),
          x: r.x,
          y: r.y,
          target: r.elementTarget ?? null,
          pageUrl: r.pageUrl,
        }));
        return;
      case 'keystrokes':
        yield* this.batched(this.prisma.keystroke_logs, sessionId, 'timestamp', (r) => ({
          wallMs: num(r.timestamp),
          fieldId: r.fieldId,
          keystrokeCount: r.keystrokeCount,
          pauseDurationMs: r.pauseDurationMs,
          typingSpeedWPM: r.typingSpeedWPM ?? null,
        }));
        return;
      case 'clipboard':
        yield* this.batched(this.prisma.clipboard_logs, sessionId, 'timestamp', (r) => ({
          wallMs: num(r.timestamp),
          action: r.action,
          textLength: r.textLength,
          sourceElement: r.sourceElement ?? null,
          pageUrl: r.pageUrl,
        }));
        return;
      case 'visibility':
        yield* this.batched(this.prisma.visibility_logs, sessionId, 'timestamp', (r) => ({
          wallMs: num(r.timestamp),
          visibleState: r.visibleState,
          hiddenDurationMs: r.hiddenDurationMs ?? null,
          pageUrl: r.pageUrl,
        }));
        return;
      case 'viewport':
        yield* this.batched(this.prisma.viewport_logs, sessionId, 'timestamp', (r) => ({
          wallMs: num(r.timestamp),
          width: r.width,
          height: r.height,
          orientation: r.orientation,
        }));
        return;
      case 'activity': {
        const rows = await this.prisma.activityLog.findMany({
          where: { sessionId },
          orderBy: { occurredAt: 'asc' },
        });
        for (const r of rows) {
          yield {
            wallMs: r.occurredAt.getTime(),
            action: r.action,
            metadata: r.metadata ?? null,
            courseId: r.courseId ?? null,
            moduleId: r.moduleId ?? null,
            moduleItemId: r.moduleItemId ?? null,
            interventionId: r.interventionId ?? null,
            dialogueSessionId: r.dialogueSessionId ?? null,
          };
        }
        return;
      }
      case 'chatbot': {
        const rows = await this.prisma.chatbotMessage.findMany({
          where: { studentSessionId: sessionId },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        for (const r of rows) {
          yield {
            wallMs: r.createdAt.getTime(),
            role: r.role,
            content: r.content,
            contextSource: r.contextSource ?? null,
            selectedText: r.selectedText ?? null,
            suggestedStrategy: r.suggestedStrategy ?? null,
            model: r.model ?? null,
            moduleItemId: r.moduleItemId ?? null,
          };
        }
        return;
      }
      case 'dialogue': {
        const s = await this.prisma.studentSession.findUnique({
          where: { id: sessionId },
          select: { userId: true, startedAt: true, endedAt: true },
        });
        if (!s) return;
        const pad = 5 * 60 * 1000;
        const rows = await this.prisma.dialogueMessage.findMany({
          where: {
            createdAt: {
              gte: new Date(s.startedAt.getTime() - pad),
              lte: new Date((s.endedAt ?? new Date()).getTime() + pad),
            },
            session: { studentId: s.userId },
          },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        });
        for (const r of rows) {
          yield {
            wallMs: r.createdAt.getTime(),
            role: r.role,
            content: r.content,
            dialogueSessionId: r.sessionId ?? null,
          };
        }
        return;
      }
      case 'interventions': {
        const ids = await this.prisma.activityLog.findMany({
          where: { sessionId, interventionId: { not: null } },
          select: { interventionId: true },
        });
        const unique = Array.from(new Set(ids.map((a: any) => a.interventionId).filter(Boolean)));
        if (unique.length === 0) return;
        const rows = await this.prisma.learningIntervention.findMany({
          where: { id: { in: unique } },
          orderBy: { createdAt: 'asc' },
        });
        for (const r of rows) {
          yield {
            wallMs: r.createdAt.getTime(),
            id: r.id,
            type: r.type,
            status: r.status,
            selectedText: r.selectedText ?? null,
            sessionData: r.sessionData ?? null,
            completedAt: r.completedAt ? r.completedAt.toISOString() : null,
            pageType: r.pageType ?? null,
            contentId: r.contentId ?? null,
            courseId: r.courseId ?? null,
          };
        }
        return;
      }
      case 'ef_detections': {
        const rows = await this.prisma.efDetection.findMany({
          where: { sessionId },
          orderBy: { createdAt: 'asc' },
        });
        for (const r of rows) {
          yield {
            wallMs: r.createdAt.getTime(),
            messageId: r.messageId ?? null,
            construct: r.constructKey,
            label: r.label,
            confidence: r.confidence ?? null,
            severity: r.severity ?? null,
            rationale: r.rationale ?? null,
          };
        }
        return;
      }
      case 'mastery': {
        const s = await this.prisma.studentSession.findUnique({
          where: { id: sessionId },
          select: { userId: true, updatedAt: true },
        });
        if (!s) return;
        const rows = await this.prisma.userMastery
          .findMany({ where: { userId: s.userId } })
          .catch(() => []);
        for (const r of rows) {
          yield {
            wallMs: (r.updatedAt ?? r.createdAt ?? s.updatedAt).getTime?.() ?? 0,
            ...serializeRow(r),
          };
        }
        return;
      }
      case 'cards': {
        const s = await this.prisma.studentSession.findUnique({
          where: { id: sessionId },
          select: { userId: true },
        });
        if (!s) return;
        const rows = await this.prisma.spacedRepetitionCard
          .findMany({ where: { userId: s.userId } })
          .catch(() => []);
        for (const r of rows) {
          yield { wallMs: (r.updatedAt ?? r.createdAt)?.getTime?.() ?? 0, ...serializeRow(r) };
        }
        return;
      }
      case 'attempts': {
        const s = await this.prisma.studentSession.findUnique({
          where: { id: sessionId },
          select: { userId: true },
        });
        if (!s) return;
        const rows = await this.prisma.attempt
          .findMany({ where: { userId: s.userId } })
          .catch(() => []);
        for (const r of rows) {
          yield { wallMs: (r.createdAt ?? r.submittedAt)?.getTime?.() ?? 0, ...serializeRow(r) };
        }
        return;
      }
      // probes / questionnaires / annotations / codes are optional and only
      // present when the live platform has those tables. Yield nothing by
      // default; a future schema can wire them in here.
      case 'probes':
      case 'questionnaires':
      case 'annotations':
      case 'codes':
        return;
    }
  }

  private async *batched(
    model: any,
    sessionId: string,
    orderField: string,
    map: (r: any) => StreamRecord,
  ): AsyncIterable<StreamRecord> {
    let skip = 0;
    for (;;) {
      const rows = await model.findMany({
        where: { sessionId },
        orderBy: { [orderField]: 'asc' },
        skip,
        take: BATCH,
      });
      if (rows.length === 0) break;
      for (const r of rows) yield map(r);
      skip += rows.length;
      if (rows.length < BATCH) break;
    }
  }
}

/** JSON-safe row serialization (BigInt -> number, Date -> ISO). */
function serializeRow(r: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(r)) {
    if (typeof v === 'bigint') out[k] = Number(v);
    else if (v instanceof Date) out[k] = v.toISOString();
    else out[k] = v;
  }
  return out;
}
