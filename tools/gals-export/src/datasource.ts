/**
 * Prisma + S3/MinIO backed implementation of SessionDataSource.
 *
 * Imports `@prisma/client` from the live GALS monorepo so the exporter reuses
 * the existing schema/types. Run `pnpm db:generate` once before exporting.
 * Connects directly to Postgres — the Nest app does NOT need to be running.
 */
import { S3Client, GetObjectCommand } from '@aws-sdk/client-s3';
import { V2_KEYS, v2Stream } from './v2streams.js';
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
  learningEvent: any;
  $queryRawUnsafe: any;
  chatbotMessage: any;
  dialogueMessage: any;
  learningIntervention: any;
  efDetection: any;
  spacedRepetitionCard: any;
  attempt: any;
  user: any;
  course: any;
  $disconnect?: () => Promise<void>;
}

/** The grading_results columns the attempts stream exports. */
interface GradingRow {
  id: string;
  score: number;
  gradedBy: string;
  feedback: string;
  createdAt: Date;
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
        ...(await this.lifecycle(sessionId)),
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

  /** v2 session fields (Prompt B, P2), read raw: the export schema predates them. */
  private async lifecycle(sessionId: string) {
    const [r] = (await this.prisma.$queryRawUnsafe(
      'SELECT close_reason, params_version, previous_session_id, episode_key, clock_offset_ms FROM student_sessions WHERE id = $1::uuid',
      sessionId,
    )) as Array<Record<string, unknown>>;
    return {
      closeReason: (r?.close_reason as string | null) ?? null,
      paramsVersion: (r?.params_version as string | null) ?? null,
      previousSessionId: (r?.previous_session_id as string | null) ?? null,
      episodeKey: (r?.episode_key as string | null) ?? null,
      clockOffsetMs: r?.clock_offset_ms == null ? null : Number(r.clock_offset_ms),
    };
  }

  private raw = (sql: string, ...params: unknown[]) =>
    this.prisma.$queryRawUnsafe(sql, ...params) as Promise<Array<Record<string, unknown>>>;

  /** An interaction stream with every column (v2: tabId, clientSeq, text, provenance). */
  private async *rawStream(
    table: string,
    sessionId: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    map: (r: Record<string, any>) => StreamRecord,
  ): AsyncIterable<StreamRecord> {
    for (let offset = 0; ; offset += BATCH) {
      const rows = await this.raw(
        `SELECT * FROM "${table}" WHERE "sessionId" = $1 ORDER BY "timestamp", id LIMIT ${BATCH} OFFSET ${offset}`,
        sessionId,
      );
      for (const r of rows) yield map(r);
      if (rows.length < BATCH) return;
    }
  }

  async *getStream(sessionId: string, key: StreamKey): AsyncIterable<StreamRecord> {
    if (V2_KEYS.has(key)) {
      const s = await this.prisma.studentSession.findUnique({
        where: { id: sessionId },
        select: { userId: true },
      });
      if (!s) return;
      yield* v2Stream(this.raw, key, sessionId, s.userId);
      return;
    }
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
        yield* this.rawStream('click_logs', sessionId, (r) => ({
          wallMs: num(r.timestamp),
          id: r.id,
          x: r.x,
          y: r.y,
          target: r.elementSelector ?? null,
          text: r.elementText ?? null,
          pageUrl: r.pageUrl,
          tabId: r.tabId ?? null,
          clientSeq: r.clientSeq ?? null,
        }));
        return;
      case 'scrolls':
        yield* this.rawStream('scroll_logs', sessionId, (r) => ({
          wallMs: num(r.timestamp),
          id: r.id,
          scrollY: r.scrollY,
          scrollPercent: r.scrollPercent,
          pageUrl: r.pageUrl,
          tabId: r.tabId ?? null,
          clientSeq: r.clientSeq ?? null,
        }));
        return;
      case 'cursors':
        yield* this.rawStream('cursor_logs', sessionId, (r) => ({
          wallMs: num(r.timestamp),
          x: r.x,
          y: r.y,
          target: r.elementTarget ?? null,
          pageUrl: r.pageUrl,
          tabId: r.tabId ?? null,
          clientSeq: r.clientSeq ?? null,
        }));
        return;
      case 'keystrokes':
        // v2: the typed burst (keys with offsets, field text), PI decision 2026-11-25.
        yield* this.rawStream('keystroke_logs', sessionId, (r) => ({
          wallMs: num(r.timestamp),
          id: r.id,
          fieldId: r.fieldId,
          keystrokeCount: r.keystrokeCount,
          pauseDurationMs: r.pauseDurationMs,
          typingSpeedWPM: r.typingSpeedWPM ?? null,
          burstStartMs: r.burstStart == null ? null : num(r.burstStart),
          fieldKind: r.fieldKind ?? null,
          keys: r.keys ?? null,
          text: r.text ?? null,
          tabId: r.tabId ?? null,
          clientSeq: r.clientSeq ?? null,
        }));
        return;
      case 'clipboard':
        // v2: the text and copy provenance (similarity to the last AI outputs).
        yield* this.rawStream('clipboard_logs', sessionId, (r) => ({
          wallMs: num(r.timestamp),
          id: r.id,
          action: r.action,
          textLength: r.textLength,
          sourceElement: r.sourceElement ?? null,
          pageUrl: r.pageUrl,
          text: r.text ?? null,
          aiSimilarity: r.aiSimilarity ?? null,
          matchedTurnId: r.matchedTurnId ?? null,
          sourceChannel: r.sourceChannel ?? null,
          targetField: r.targetField ?? null,
          tabId: r.tabId ?? null,
          clientSeq: r.clientSeq ?? null,
        }));
        return;
      case 'visibility':
        yield* this.rawStream('visibility_logs', sessionId, (r) => ({
          wallMs: num(r.timestamp),
          id: r.id,
          visibleState: r.visibleState,
          hiddenDurationMs: r.hiddenDurationMs ?? null,
          pageUrl: r.pageUrl,
          tabId: r.tabId ?? null,
          clientSeq: r.clientSeq ?? null,
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
        // v2: row id and the envelope (CAP-81, Prompt B P1); v1 keys kept.
        const rows = await this.raw(
          'SELECT * FROM activity_logs WHERE session_id = $1::uuid ORDER BY occurred_at, id',
          sessionId,
        );
        for (const r of rows) {
          const at = r.occurred_at as Date;
          const recv = r.server_received_at as Date | null;
          yield {
            wallMs: at.getTime(),
            id: r.id,
            action: r.action,
            metadata: r.metadata ?? null,
            courseId: r.course_id ?? null,
            moduleId: r.module_id ?? null,
            moduleItemId: r.module_item_id ?? null,
            interventionId: r.intervention_id ?? null,
            dialogueSessionId: r.dialogue_session_id ?? null,
            assessmentId: r.assessment_id ?? null,
            attemptId: r.attempt_id ?? null,
            questionId: r.question_id ?? null,
            clientEventId: r.client_event_id ?? null,
            clientSeq: r.client_seq ?? null,
            tabId: r.tab_id ?? null,
            serverReceivedMs: recv ? recv.getTime() : null,
            durationMs: r.duration_ms ?? null,
            sourceChannel: r.source_channel ?? null,
            appBuild: r.app_build ?? null,
            consentScope: r.consent_scope ?? null,
            slideKey: r.slide_key ?? null,
            objectId: r.object_id ?? null,
            contentVersion: r.content_version ?? null,
            qualityCode: r.quality_code ?? null,
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
        // CAP-83: the column is studentId (querying userId failed validation
        // and the error was swallowed, so every bundle had 0 attempts).
        // Scoped to attempts started or submitted during this session; errors
        // now fail the export instead of yielding an empty stream.
        const s = await this.prisma.studentSession.findUnique({
          where: { id: sessionId },
          select: { userId: true, startedAt: true, endedAt: true },
        });
        if (!s) return;
        const window = { gte: s.startedAt, lte: s.endedAt ?? new Date() };
        const rows = await this.prisma.attempt.findMany({
          where: {
            studentId: s.userId,
            OR: [{ createdAt: window }, { submittedAt: window }],
          },
          include: {
            question: { select: { courseId: true, type: true, maxScore: true } },
            gradingResults: { orderBy: { createdAt: 'asc' } },
          },
          orderBy: { createdAt: 'asc' },
        });
        const consent = new Map<string, boolean>();
        for (const r of rows) {
          const { question, gradingResults, textResponse, autoFeedback, ...rest } = r;
          // Answer and feedback text only with research-use consent (c).
          const text = await this.researchUse(consent, r.studentId, question?.courseId ?? null);
          yield {
            wallMs: (r.submittedAt ?? r.createdAt).getTime(),
            ...serializeRow(rest),
            courseId: question?.courseId ?? null,
            questionType: question?.type ?? null,
            maxScore: question?.maxScore ?? null,
            textResponse: text ? (textResponse ?? null) : null,
            textResponseChars: textResponse?.length ?? 0,
            autoFeedback: text ? (autoFeedback ?? null) : null,
            gradingResults: (gradingResults as GradingRow[]).map((g) => ({
              id: g.id,
              score: g.score,
              gradedBy: g.gradedBy,
              createdAt: g.createdAt.toISOString(),
              feedback: text ? g.feedback : null,
            })),
          };
        }
        return;
      }
      // probes / questionnaires / annotations / codes are optional and only
      // present when the live platform has those tables. Yield nothing by
      // default; a future schema can wire them in here.
      case 'learning_events': {
        // The current library/parameter version only; earlier versions stay
        // in the database (Prompt B, P4). Provenance is added in bundle v2 (P7).
        const rows = await this.prisma.learningEvent.findMany({
          where: { sessionId, isCurrent: true },
          orderBy: [{ startAt: 'asc' }, { id: 'asc' }],
        });
        // Prompting-course research use (text_capture_consents, latest row per
        // learner and course): without consent (c) the stream is omitted.
        const consentByCourse = new Map<string, boolean>();
        for (const r of rows) {
          if (!(await this.researchUse(consentByCourse, r.studentId, r.courseId ?? null))) continue;
          yield {
            wallMs: r.startAt.getTime(),
            endWallMs: r.endAt.getTime(),
            ruleId: r.ruleId,
            eventFamily: r.eventFamily,
            outcome: r.outcome ?? null,
            moduleItemId: r.moduleItemId ?? null,
            slideKey: r.slideKey ?? null,
            confidence: r.confidence,
            libraryVersion: r.libraryVersion,
            parameterSetVersion: r.parameterSetVersion,
            // v2: provenance (CAP-69/80, Prompt B P4)
            id: r.id,
            detectionKey: r.detectionKey ?? null,
            sourceActionIds: r.sourceActionIds,
            sourceRefs: r.sourceRefs ?? [],
            detail: r.detail ?? null,
            computedValues: r.computedValues ?? null,
            alternatives: r.alternatives ?? [],
            evidenceClass: r.evidenceClass ?? null,
            libraryHash: r.libraryHash ?? null,
            parameterHash: r.parameterHash ?? null,
            engineVersion: r.engineVersion ?? null,
            computedAt: r.computedAt.toISOString(),
          };
        }
        return;
      }
      case 'probes':
      case 'questionnaires':
      case 'annotations':
      case 'codes':
        return;
    }
  }

  /**
   * Research use (c) for a learner in a course. By default consent comes from
   * the study consent form, so it is always true. With TEXT_CONSENT_IN_APP=true
   * it is the latest text_capture_consents row (no decision or no course = no
   * consent). Cached per export stream.
   */
  private async researchUse(
    cache: Map<string, boolean>,
    studentId: string,
    courseId: string | null,
  ): Promise<boolean> {
    // Study consent form (default): covers research use for every learner.
    if (process.env.TEXT_CONSENT_IN_APP !== 'true') return true;
    if (!courseId) return false;
    const key = `${studentId}|${courseId}`;
    if (!cache.has(key)) {
      const res = (await this.prisma.$queryRawUnsafe(
        'SELECT research_use FROM text_capture_consents WHERE student_id = $1::uuid AND course_id = $2::uuid ORDER BY decided_at DESC LIMIT 1',
        studentId,
        courseId,
      )) as Array<{ research_use: boolean }>;
      cache.set(key, res[0]?.research_use === true);
    }
    return cache.get(key)!;
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
