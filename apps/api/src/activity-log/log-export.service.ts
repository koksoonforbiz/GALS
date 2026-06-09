import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LogExportService {
  private readonly logger = new Logger(LogExportService.name);
  private readonly s3: S3Client;
  /** Separate client whose endpoint matches what the browser will use — so the presigned URL host is correct. */
  private readonly s3Public: S3Client;
  private readonly bucket: string;
  private readonly recordingBucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    const internalEndpoint = config.get<string>('BLOB_STORAGE_ENDPOINT', 'http://localhost:9000');
    // Public endpoint is what the browser reaches (e.g. http://localhost:9000 on the host machine).
    // Presigned URLs must be signed with this host so MinIO validates the Host header correctly.
    const publicEndpoint = config.get<string>('BLOB_STORAGE_PUBLIC_ENDPOINT', internalEndpoint);
    const region = config.get<string>('BLOB_STORAGE_REGION', 'us-east-1');
    const credentials = {
      accessKeyId: config.get<string>('BLOB_STORAGE_ACCESS_KEY', 'minioadmin'),
      secretAccessKey: config.get<string>('BLOB_STORAGE_SECRET_KEY', 'minioadmin'),
    };
    this.s3 = new S3Client({
      endpoint: internalEndpoint,
      region,
      credentials,
      forcePathStyle: true,
    });
    this.s3Public = new S3Client({
      endpoint: publicEndpoint,
      region,
      credentials,
      forcePathStyle: true,
    });
    this.bucket = config.get<string>('MINIO_LOG_BUCKET', 'student-logs');
    this.recordingBucket = config.get<string>('BLOB_STORAGE_BUCKET', 'ats-blobs');
  }

  /**
   * Build a fully documented JSON export for one session.
   * Includes all biometrics, interaction logs, messages, and
   * presigned download URLs for each recording segment.
   */
  async buildSessionLogDocument(sessionId: string): Promise<object> {
    const session = await this.prisma.studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        summary: true,
      },
    });

    // Resolve course name if available
    let courseName: string | null = null;
    if (session.courseId) {
      const course = await this.prisma.course.findUnique({
        where: { id: session.courseId },
        select: { title: true },
      });
      courseName = course?.title ?? null;
    }

    // Fetch all data in parallel
    const [
      logs,
      replaySnapshots,
      emotionFrames,
      auResults,
      gazeLogs,
      pupilLogs,
      clickLogs,
      scrollLogs,
      keystrokeLogs,
      cursorLogs,
      clipboardLogs,
      visibilityLogs,
      viewportLogs,
      chatbotMessages,
      efDetections,
      recordingSegments,
    ] = await Promise.all([
      this.prisma.activityLog.findMany({
        where: { sessionId },
        orderBy: { occurredAt: 'asc' },
      }),
      // Exclude html and screenshotDataUrl — both are very large text blobs
      // that cause Prisma's rust→napi bridge to fail on long sessions.
      // screenshotDataUrl is fetched separately in batches below.
      // html is omitted from the export (gigabytes for long sessions).
      this.prisma.sessionReplaySnapshot.findMany({
        where: { sessionId },
        orderBy: { capturedAt: 'asc' },
        select: {
          id: true,
          pageUrl: true,
          width: true,
          height: true,
          scrollX: true,
          scrollY: true,
          capturedAt: true,
          trigger: true,
        },
      }),
      this.prisma.emotionFrame.findMany({
        where: { sessionId },
        orderBy: { frameWallMs: 'asc' },
      }),
      this.prisma.pyfeatAuResult.findMany({
        where: { job: { sessionId } },
        orderBy: { wallTime: 'asc' },
      }),
      this.prisma.webgazerLog.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.pupilSizeLog.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.click_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.scroll_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.keystroke_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.cursor_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.clipboard_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.visibility_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.viewport_logs.findMany({
        where: { sessionId },
        orderBy: { timestamp: 'asc' },
      }),
      this.prisma.chatbotMessage.findMany({
        where: { studentSessionId: sessionId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.efDetection.findMany({
        where: { sessionId },
        orderBy: { createdAt: 'asc' },
      }),
      this.prisma.recordingSegment.findMany({
        where: { sessionId },
        orderBy: { startWallTime: 'asc' },
      }),
    ]);

    // Fetch screenshotDataUrl in batches to avoid Prisma rust→napi size limit
    const BATCH = 50;
    const screenshotMap = new Map<string, string | null>();
    for (let i = 0; i < replaySnapshots.length; i += BATCH) {
      const batchIds = replaySnapshots.slice(i, i + BATCH).map((s) => s.id);
      const rows = await this.prisma.sessionReplaySnapshot.findMany({
        where: { id: { in: batchIds } },
        select: { id: true, screenshotDataUrl: true },
      });
      for (const row of rows) screenshotMap.set(row.id, row.screenshotDataUrl ?? null);
    }

    // Generate presigned download URLs for each completed recording segment
    const recordingsWithUrls = await Promise.all(
      recordingSegments.map(async (seg, i) => {
        let downloadUrl: string | null = null;
        if (seg.uploadStatus === 'COMPLETED' && seg.minioKey) {
          try {
            downloadUrl = await getSignedUrl(
              this.s3Public,
              new GetObjectCommand({ Bucket: this.recordingBucket, Key: seg.minioKey }),
              { expiresIn: 3600 },
            );
          } catch {
            // Non-fatal — segment may have been deleted
          }
        }
        return {
          index: i,
          filename: `recording_${i}.webm`,
          id: seg.id,
          uploadStatus: seg.uploadStatus,
          startWallTime: seg.startWallTime?.toISOString() ?? null,
          endWallTime: seg.endWallTime?.toISOString() ?? null,
          durationMs: seg.durationMs,
          fileSizeBytes: seg.fileSizeBytes,
          mimeType: seg.mimeType,
          downloadUrl,
        };
      }),
    );

    // Group conversation messages for convenience
    const conversationHistory = logs
      .filter((l) => ['DIALOGUE_MESSAGE_SENT', 'DIALOGUE_MESSAGE_RECEIVED'].includes(l.action))
      .map((l) => {
        const meta = l.metadata as Record<string, unknown> | null;
        return {
          role: meta?.role ?? 'unknown',
          text: meta?.messageText ?? '',
          timestamp: l.occurredAt.toISOString(),
          dialogueSessionId: l.dialogueSessionId,
        };
      });

    const interventionEvents = logs
      .filter((l) => l.action.startsWith('INTERVENTION_'))
      .map((l) => ({
        action: l.action,
        timestamp: l.occurredAt.toISOString(),
        interventionId: l.interventionId,
        metadata: l.metadata,
      }));

    const assessmentEvents = logs
      .filter((l) => l.action.startsWith('ASSESSMENT_') || l.action.startsWith('QUESTION_'))
      .map((l) => ({
        action: l.action,
        timestamp: l.occurredAt.toISOString(),
        assessmentId: l.assessmentId,
        attemptId: l.attemptId,
        questionId: l.questionId,
        metadata: l.metadata,
      }));

    const masteryTrajectory = logs
      .filter((l) => l.action === 'MASTERY_UPDATED')
      .map((l) => ({
        timestamp: l.occurredAt.toISOString(),
        kcId: l.kcId,
        ...(l.metadata as object | null),
      }));

    return {
      _meta: {
        exportedAt: new Date().toISOString(),
        schemaVersion: '2.0',
        platform: 'GALS — Guided Adaptive Learning System',
        sessionId,
        studentName: session.user.name,
        courseName,
        sessionStartedAt: session.startedAt.toISOString(),
      },
      session: {
        id: session.id,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        durationSecs: session.durationSecs,
        courseId: session.courseId,
        courseName,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      },
      student: session.user,
      summary: session.summary,

      // ── Biometrics ────────────────────────────────────────────────────────
      biometrics: {
        emotionFrames: emotionFrames.map((f) => ({
          frameWallMs: Number(f.frameWallMs),
          frameIndex: f.frameIndex,
          faceDetected: f.faceDetected,
          pHappiness: f.pHappiness,
          pSadness: f.pSadness,
          pSurprise: f.pSurprise,
          pFear: f.pFear,
          pAnger: f.pAnger,
          pDisgust: f.pDisgust,
          pContempt: f.pContempt,
          pNeutral: f.pNeutral,
          dominantEmotion: f.dominantEmotion,
          dominantProbability: f.dominantProbability,
          headPoseYaw: f.headPoseYaw,
          headPosePitch: f.headPosePitch,
          headPoseRoll: f.headPoseRoll,
        })),
        actionUnits: auResults.map((a) => ({
          frameIndex: a.frameIndex,
          wallTime: a.wallTime.toISOString(),
          au01: a.au01,
          au02: a.au02,
          au04: a.au04,
          au05: a.au05,
          au06: a.au06,
          au07: a.au07,
          au09: a.au09,
          au10: a.au10,
          au12: a.au12,
          au14: a.au14,
          au15: a.au15,
          au17: a.au17,
          au20: a.au20,
          au23: a.au23,
          au24: a.au24,
          au25: a.au25,
          au26: a.au26,
          au28: a.au28,
          faceConf: a.faceConf,
        })),
        gaze: gazeLogs.map((g) => ({
          timestamp: g.timestamp.toISOString(),
          gazeX: g.gazeX,
          gazeY: g.gazeY,
          confidence: g.confidence,
          pageUrl: g.pageUrl,
        })),
        pupil: pupilLogs.map((p) => ({
          timestamp: p.timestamp.toISOString(),
          pupilDiameter: p.pupilDiameter,
        })),
      },

      // ── Interaction logs ──────────────────────────────────────────────────
      interactions: {
        clicks: clickLogs.map((c) => ({
          timestamp: new Date(Number(c.timestamp)).toISOString(),
          x: c.x,
          y: c.y,
          pageUrl: c.pageUrl,
          elementSelector: c.elementSelector,
          elementText: c.elementText,
        })),
        scrolls: scrollLogs.map((s) => ({
          timestamp: new Date(Number(s.timestamp)).toISOString(),
          scrollY: s.scrollY,
          scrollPercent: s.scrollPercent,
          pageUrl: s.pageUrl,
        })),
        keystrokes: keystrokeLogs.map((k) => ({
          timestamp: new Date(Number(k.timestamp)).toISOString(),
          fieldId: k.fieldId,
          keystrokeCount: k.keystrokeCount,
          pauseDurationMs: k.pauseDurationMs,
          typingSpeedWPM: k.typingSpeedWPM,
        })),
        cursor: cursorLogs.map((c) => ({
          timestamp: new Date(Number(c.timestamp)).toISOString(),
          x: c.x,
          y: c.y,
          pageUrl: c.pageUrl,
          elementTarget: c.elementTarget,
        })),
        clipboard: clipboardLogs.map((c) => ({
          timestamp: new Date(Number(c.timestamp)).toISOString(),
          action: c.action,
          textLength: c.textLength,
          sourceElement: c.sourceElement,
          pageUrl: c.pageUrl,
        })),
        visibility: visibilityLogs.map((v) => ({
          timestamp: new Date(Number(v.timestamp)).toISOString(),
          visibleState: v.visibleState,
          hiddenDurationMs: v.hiddenDurationMs,
          pageUrl: v.pageUrl,
        })),
        viewport: viewportLogs.map((v) => ({
          timestamp: new Date(Number(v.timestamp)).toISOString(),
          width: v.width,
          height: v.height,
          orientation: v.orientation,
        })),
      },

      // ── Conversations & AI interactions ───────────────────────────────────
      communications: {
        chatbotMessages: chatbotMessages.map((m) => ({
          createdAt: m.createdAt.toISOString(),
          role: m.role,
          content: m.content,
          contextSource: m.contextSource,
          selectedText: m.selectedText,
          suggestedStrategy: m.suggestedStrategy,
          promptTokens: m.promptTokens,
          completionTokens: m.completionTokens,
          model: m.model,
        })),
        dialogueHistory: conversationHistory,
      },

      // ── Learning activity ─────────────────────────────────────────────────
      learning: {
        interventionEvents,
        assessmentEvents,
        masteryTrajectory,
        efDetections: efDetections.map((e) => ({
          createdAt: e.createdAt.toISOString(),
          constructKey: e.constructKey,
          label: e.label,
          confidence: e.confidence,
          severity: e.severity,
          rationale: e.rationale,
        })),
      },

      // ── Full event log ────────────────────────────────────────────────────
      fullEventLog: logs.map((l) => ({
        id: l.id,
        action: l.action,
        occurredAt: l.occurredAt.toISOString(),
        courseId: l.courseId,
        moduleId: l.moduleId,
        moduleItemId: l.moduleItemId,
        assessmentId: l.assessmentId,
        attemptId: l.attemptId,
        questionId: l.questionId,
        dialogueSessionId: l.dialogueSessionId,
        interventionId: l.interventionId,
        kcId: l.kcId,
        metadata: l.metadata,
      })),

      // ── DOM replay snapshots ──────────────────────────────────────────────
      replay: {
        snapshotCount: replaySnapshots.length,
        snapshots: replaySnapshots.map((s) => ({
          id: s.id,
          pageUrl: s.pageUrl,
          width: s.width,
          height: s.height,
          scrollX: s.scrollX,
          scrollY: s.scrollY,
          capturedAt: Number(s.capturedAt),
          trigger: s.trigger,
          screenshotDataUrl: screenshotMap.get(s.id) ?? null,
        })),
      },

      // ── Recordings ───────────────────────────────────────────────────────
      recordings: recordingsWithUrls,
    };
  }

  /**
   * Upload a session log to MinIO and return a 1-hour presigned download URL.
   */
  async exportToStorage(sessionId: string, userId: string): Promise<string> {
    const doc = await this.buildSessionLogDocument(sessionId);
    const json = JSON.stringify(doc, null, 2);
    const key = `student-logs/${userId}/${sessionId}.json`;

    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: json,
        ContentType: 'application/json',
      }),
    );

    const url = await getSignedUrl(
      this.s3Public,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 3600 },
    );

    this.logger.log(`Log exported: ${key}`);
    return url;
  }
}
