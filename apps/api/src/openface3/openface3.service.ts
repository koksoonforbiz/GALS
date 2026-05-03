import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import Redis from 'ioredis';

const OPENFACE3_QUEUE_KEY = 'openface3:jobs';

@Injectable()
export class Openface3Service {
  private readonly logger = new Logger(Openface3Service.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
    private readonly config: ConfigService,
  ) {
    this.redis = new Redis(this.config.get<string>('REDIS_URL', 'redis://localhost:6379'));
  }

  async enqueueJob(args: {
    recordingSegmentId: string;
    sessionId: string;
    studentId: string;
    courseId: string;
    minioKey: string;
    segmentStartWallMs: number;
    extractionFps?: number;
    detectorBackend?: string;
  }) {
    const job = await this.prisma.openface3Job.create({
      data: {
        recordingSegmentId: args.recordingSegmentId,
        status: 'PENDING',
        extractionFps: args.extractionFps ?? 5,
        detectorBackend: args.detectorBackend ?? 'retinaface',
      },
    });

    const payload = JSON.stringify({
      jobId: job.id,
      recordingSegmentId: args.recordingSegmentId,
      minioBucket: 'ats-blobs',
      minioKey: args.minioKey,
      sessionId: args.sessionId,
      userId: args.studentId,
      courseId: args.courseId,
      segmentStartWallMs: args.segmentStartWallMs,
      extractionFps: args.extractionFps ?? 5,
    });

    await this.redis.rpush(OPENFACE3_QUEUE_KEY, payload);
    this.logger.log(`Enqueued OpenFace 3 job ${job.id} for segment ${args.recordingSegmentId}`);

    return job;
  }

  async getJob(jobId: string) {
    return this.prisma.openface3Job.findUnique({ where: { id: jobId } });
  }

  async listJobs(filters: { sessionId?: string; status?: string }) {
    const where: Record<string, unknown> = {};
    if (filters.sessionId) {
      where.recordingSegment = { sessionId: filters.sessionId };
    }
    if (filters.status) {
      where.status = filters.status;
    }
    return this.prisma.openface3Job.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 100,
    });
  }

  async retryJob(jobId: string) {
    const job = await this.prisma.openface3Job.findUnique({ where: { id: jobId } });
    if (!job || job.status !== 'FAILED') return null;

    await this.prisma.openface3Job.update({
      where: { id: jobId },
      data: { status: 'PENDING', retries: job.retries + 1, errorMessage: null },
    });

    const segment = await this.prisma.recordingSegment.findUnique({
      where: { id: job.recordingSegmentId },
    });
    if (!segment) return null;

    const payload = JSON.stringify({
      jobId: job.id,
      recordingSegmentId: job.recordingSegmentId,
      minioBucket: 'ats-blobs',
      minioKey: segment.minioKey,
      sessionId: segment.sessionId,
      userId: segment.studentId,
      courseId: segment.courseId,
      segmentStartWallMs: segment.startWallTime.getTime(),
      extractionFps: job.extractionFps,
    });

    await this.redis.rpush(OPENFACE3_QUEUE_KEY, payload);
    this.logger.log(`Retried OpenFace 3 job ${jobId}`);
    return job;
  }

  async getFrames(filters: { sessionId?: string; from?: string; to?: string; limit?: number }) {
    const where: Record<string, unknown> = {};
    if (filters.sessionId) where.sessionId = filters.sessionId;
    if (filters.from || filters.to) {
      where.frameWallMs = {};
      if (filters.from) (where.frameWallMs as Record<string, unknown>).gte = BigInt(filters.from);
      if (filters.to) (where.frameWallMs as Record<string, unknown>).lte = BigInt(filters.to);
    }

    return this.prisma.emotionFrame.findMany({
      where,
      orderBy: { frameWallMs: 'asc' },
      take: Math.min(filters.limit ?? 1000, 5000),
    });
  }

  async getStudentFrames(
    studentId: string,
    filters: { courseId?: string; from?: string; to?: string },
  ) {
    const where: Record<string, unknown> = { userId: studentId };
    if (filters.courseId) where.courseId = filters.courseId;
    if (filters.from || filters.to) {
      where.frameWallMs = {};
      if (filters.from) (where.frameWallMs as Record<string, unknown>).gte = BigInt(filters.from);
      if (filters.to) (where.frameWallMs as Record<string, unknown>).lte = BigInt(filters.to);
    }

    return this.prisma.emotionFrame.findMany({
      where,
      orderBy: { frameWallMs: 'asc' },
      take: 5000,
    });
  }

  async getSessionSummary(sessionId: string) {
    const frames = await this.prisma.emotionFrame.findMany({
      where: { sessionId, faceDetected: true },
    });

    if (frames.length === 0) return { totalFrames: 0, facesDetected: 0, emotions: {} };

    const emotions = [
      'happiness',
      'sadness',
      'surprise',
      'fear',
      'anger',
      'disgust',
      'contempt',
      'neutral',
    ];
    const counts: Record<string, number> = {};
    const sums: Record<string, number> = {};

    for (const e of emotions) {
      counts[e] = 0;
      sums[e] = 0;
    }

    for (const f of frames) {
      if (f.dominantEmotion) {
        counts[f.dominantEmotion] = (counts[f.dominantEmotion] ?? 0) + 1;
      }
      sums['happiness'] = (sums['happiness'] ?? 0) + (f.pHappiness ?? 0);
      sums['sadness'] = (sums['sadness'] ?? 0) + (f.pSadness ?? 0);
      sums['surprise'] = (sums['surprise'] ?? 0) + (f.pSurprise ?? 0);
      sums['fear'] = (sums['fear'] ?? 0) + (f.pFear ?? 0);
      sums['anger'] = (sums['anger'] ?? 0) + (f.pAnger ?? 0);
      sums['disgust'] = (sums['disgust'] ?? 0) + (f.pDisgust ?? 0);
      sums['contempt'] = (sums['contempt'] ?? 0) + (f.pContempt ?? 0);
      sums['neutral'] = (sums['neutral'] ?? 0) + (f.pNeutral ?? 0);
    }

    const n = frames.length;
    const means: Record<string, number> = {};
    for (const e of emotions) {
      means[e] = Math.round(((sums[e] ?? 0) / n) * 1000) / 1000;
    }

    return {
      totalFrames: await this.prisma.emotionFrame.count({ where: { sessionId } }),
      facesDetected: n,
      dominantCounts: counts,
      meanProbabilities: means,
    };
  }
}
