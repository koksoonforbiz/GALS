import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import type { RecordingConfig, RecordingSegment } from '@prisma/client';
import type { RecordingConfigDto } from './dto/recording-config.dto';
import type { CreateSegmentDto } from './dto/create-segment.dto';
import type { CompleteSegmentDto } from './dto/complete-segment.dto';

@Injectable()
export class RecordingService {
  private readonly logger = new Logger(RecordingService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
  ) {}

  async getConfig(courseId: string): Promise<RecordingConfig> {
    let config = await this.prisma.recordingConfig.findUnique({
      where: { courseId },
    });
    if (!config) {
      config = await this.prisma.recordingConfig.create({
        data: { courseId, isEnabled: false },
      });
    }
    return config;
  }

  async updateConfig(courseId: string, dto: RecordingConfigDto): Promise<RecordingConfig> {
    return this.prisma.recordingConfig.upsert({
      where: { courseId },
      update: { isEnabled: dto.isEnabled },
      create: { courseId, isEnabled: dto.isEnabled },
    });
  }

  async initiateSegment(
    studentId: string,
    dto: CreateSegmentDto,
  ): Promise<{ segmentId: string; uploadUrl: string; minioKey: string }> {
    const now = new Date(dto.startWallTime);
    const dateStr = now.toISOString().slice(0, 10); // YYYY-MM-DD
    const timeStr =
      now.toISOString().slice(11, 19).replace(/:/g, '') +
      '-' +
      String(now.getMilliseconds()).padStart(3, '0');
    const filename = `${studentId}_${dto.sessionId}_${dateStr}_${timeStr}_${dto.segmentIndex}.webm`;
    const minioKey = `recordings/${dto.courseId}/${studentId}/${dto.sessionId}/${filename}`;

    const segment = await this.prisma.recordingSegment.create({
      data: {
        studentId,
        sessionId: dto.sessionId,
        courseId: dto.courseId,
        minioKey,
        filename,
        startWallTime: now,
        segmentIndex: dto.segmentIndex,
        mimeType: dto.mimeType || 'video/webm',
        uploadStatus: 'PENDING',
      },
    });

    const uploadUrl = await this.blob.getPresignedUploadUrl({
      key: minioKey,
      contentType: dto.mimeType || 'video/webm',
      expiresIn: 7200, // 2 hours
    });

    return { segmentId: segment.id, uploadUrl, minioKey };
  }

  async completeSegment(segmentId: string, dto: CompleteSegmentDto): Promise<RecordingSegment> {
    const segment = await this.prisma.recordingSegment.findUnique({
      where: { id: segmentId },
    });
    if (!segment) throw new NotFoundException('Segment not found');

    const updated = await this.prisma.recordingSegment.update({
      where: { id: segmentId },
      data: {
        uploadStatus: 'COMPLETED',
        endWallTime: new Date(dto.endWallTime),
        durationMs: dto.durationMs,
        fileSizeBytes: dto.fileSizeBytes,
      },
    });

    this.logger.log(
      `Segment ${segmentId} completed: ${updated.filename} (${dto.fileSizeBytes} bytes, ${dto.durationMs}ms)`,
    );

    return updated;
  }

  async failSegment(segmentId: string, error: string): Promise<void> {
    await this.prisma.recordingSegment.update({
      where: { id: segmentId },
      data: { uploadStatus: 'FAILED' },
    });
    this.logger.warn(`Segment ${segmentId} failed: ${error}`);
  }

  async getSegments(studentId: string, courseId: string): Promise<RecordingSegment[]> {
    return this.prisma.recordingSegment.findMany({
      where: { studentId, courseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDownloadUrl(segmentId: string): Promise<string> {
    const segment = await this.prisma.recordingSegment.findUnique({
      where: { id: segmentId },
    });
    if (!segment) throw new NotFoundException('Segment not found');

    return this.blob.getPresignedDownloadUrl({
      key: segment.minioKey,
      expiresIn: 3600,
    });
  }

  // ─── Consent ──────────────────────────────────────────

  async getConsent(studentId: string, courseId: string): Promise<boolean> {
    const consent = await this.prisma.recordingConsent.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });
    return consent?.accepted ?? false;
  }

  async giveConsent(studentId: string, courseId: string): Promise<void> {
    await this.prisma.recordingConsent.upsert({
      where: { studentId_courseId: { studentId, courseId } },
      update: { accepted: true },
      create: { studentId, courseId, accepted: true },
    });
  }
}
