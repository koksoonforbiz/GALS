import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { S3Client, PutObjectCommand, GetObjectCommand } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class LogExportService {
  private readonly logger = new Logger(LogExportService.name);
  private readonly s3: S3Client;
  private readonly bucket: string;

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {
    this.s3 = new S3Client({
      endpoint: config.get<string>('MINIO_ENDPOINT', 'http://localhost:9000'),
      region: 'us-east-1',
      credentials: {
        accessKeyId: config.get<string>('MINIO_ACCESS_KEY', 'minioadmin'),
        secretAccessKey: config.get<string>('MINIO_SECRET_KEY', 'minioadmin'),
      },
      forcePathStyle: true,
    });
    this.bucket = config.get<string>('MINIO_LOG_BUCKET', 'student-logs');
  }

  /**
   * Build a fully documented JSON log document for one session.
   * Schema mirrors the structure teachers and data analysts expect.
   */
  async buildSessionLogDocument(sessionId: string): Promise<object> {
    const session = await this.prisma.studentSession.findUniqueOrThrow({
      where: { id: sessionId },
      include: {
        user: { select: { id: true, name: true, email: true } },
        summary: true,
      },
    });

    const logs = await this.prisma.activityLog.findMany({
      where: { sessionId },
      orderBy: { occurredAt: 'asc' },
    });

    // Group conversation messages for text mining convenience
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

    // Group intervention events
    const interventionEvents = logs
      .filter((l) => l.action.startsWith('INTERVENTION_'))
      .map((l) => ({
        action: l.action,
        timestamp: l.occurredAt.toISOString(),
        interventionId: l.interventionId,
        metadata: l.metadata,
      }));

    // Group assessment events
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

    // Mastery trajectory
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
        schemaVersion: '1.0',
        platform: 'ATS — Adaptive Tutoring System',
      },
      session: {
        id: session.id,
        startedAt: session.startedAt.toISOString(),
        endedAt: session.endedAt?.toISOString() ?? null,
        durationSecs: session.durationSecs,
        ipAddress: session.ipAddress,
        userAgent: session.userAgent,
      },
      student: session.user,
      summary: session.summary,
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
      conversationHistory,
      interventionEvents,
      assessmentEvents,
      masteryTrajectory,
    };
  }

  /**
   * Upload a session log to MinIO and return a 1-hour presigned download URL.
   * Object key: student-logs/{userId}/{sessionId}.json
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
      this.s3,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: 3600 },
    );

    this.logger.log(`Log exported: ${key}`);
    return url;
  }
}
