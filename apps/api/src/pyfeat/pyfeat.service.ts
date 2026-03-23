import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import type { PyfeatConfig, PyfeatJob, PyfeatAuResult } from '@prisma/client';
import type { PyfeatConfigDto } from './dto/pyfeat-config.dto';
import type { EnqueueJobDto } from './dto/enqueue-job.dto';
import Redis from 'ioredis';

const PYFEAT_QUEUE_KEY = 'pyfeat:jobs';

@Injectable()
export class PyfeatService {
  private readonly logger = new Logger(PyfeatService.name);
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
    private readonly config: ConfigService,
  ) {
    this.redis = new Redis(this.config.get<string>('REDIS_URL', 'redis://localhost:6379'));
  }

  async getConfig(courseId: string): Promise<PyfeatConfig> {
    let cfg = await this.prisma.pyfeatConfig.findUnique({ where: { courseId } });
    if (!cfg) {
      cfg = await this.prisma.pyfeatConfig.create({
        data: {
          courseId,
          isEnabled: false,
          extractionFps: 1.0,
          enabledAus: ['AU01', 'AU04', 'AU06', 'AU07', 'AU12', 'AU17', 'AU25', 'AU26'],
          detectorBackend: 'retinaface',
          auPredictor: 'xgb',
        },
      });
    }
    return cfg;
  }

  async updateConfig(courseId: string, dto: PyfeatConfigDto): Promise<PyfeatConfig> {
    return this.prisma.pyfeatConfig.upsert({
      where: { courseId },
      update: {
        isEnabled: dto.isEnabled,
        extractionFps: dto.extractionFps,
        enabledAus: dto.enabledAus,
        detectorBackend: dto.detectorBackend,
        auPredictor: dto.auPredictor,
      },
      create: {
        courseId,
        isEnabled: dto.isEnabled,
        extractionFps: dto.extractionFps,
        enabledAus: dto.enabledAus,
        detectorBackend: dto.detectorBackend,
        auPredictor: dto.auPredictor,
      },
    });
  }

  async enqueueJob(dto: EnqueueJobDto): Promise<PyfeatJob> {
    const config = await this.getConfig(dto.courseId);

    const job = await this.prisma.pyfeatJob.create({
      data: {
        studentId: dto.studentId,
        sessionId: dto.sessionId,
        courseId: dto.courseId,
        status: 'PENDING',
        sourceMinioKey: dto.sourceMinioKey,
      },
    });

    const payload = JSON.stringify({
      jobId: job.id,
      studentId: dto.studentId,
      sessionId: dto.sessionId,
      courseId: dto.courseId,
      sourceMinioKey: dto.sourceMinioKey,
      extractionFps: config.extractionFps,
      enabledAus: config.enabledAus,
      detectorBackend: config.detectorBackend,
      auPredictor: config.auPredictor,
      clipStartWallTime: dto.clipStartWallTime,
    });

    await this.redis.rpush(PYFEAT_QUEUE_KEY, payload);
    this.logger.log(`Enqueued py-feat job ${job.id} for session ${dto.sessionId}`);

    return job;
  }

  async getJobs(studentId: string, courseId: string): Promise<PyfeatJob[]> {
    return this.prisma.pyfeatJob.findMany({
      where: { studentId, courseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getJobResults(jobId: string): Promise<PyfeatAuResult[]> {
    return this.prisma.pyfeatAuResult.findMany({
      where: { jobId },
      orderBy: { frameIndex: 'asc' },
    });
  }

  async exportJobCsv(jobId: string): Promise<string> {
    const job = await this.prisma.pyfeatJob.findUnique({ where: { id: jobId } });
    if (!job || !job.resultMinioKey) {
      throw new Error('Job not found or not yet completed');
    }
    return this.blob.getPresignedDownloadUrl({ key: job.resultMinioKey, expiresIn: 3600 });
  }
}
