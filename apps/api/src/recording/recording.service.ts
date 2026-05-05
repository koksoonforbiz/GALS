import { Injectable, Logger, NotFoundException, Inject, forwardRef } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import { PyfeatService } from '../pyfeat/pyfeat.service';
import { Openface3Service } from '../openface3/openface3.service';
import { ActivityLogService } from '../activity-log/activity-log.service';
import { ActivityAction } from '../activity-log/activity-action.enum';
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
    @Inject(forwardRef(() => PyfeatService))
    private readonly pyfeatService: PyfeatService,
    @Inject(forwardRef(() => Openface3Service))
    private readonly openface3Service: Openface3Service,
    private readonly activityLog: ActivityLogService,
  ) {}

  async getConfig(courseId: string): Promise<RecordingConfig> {
    let config = await this.prisma.recordingConfig.findUnique({
      where: { courseId },
    });
    if (!config) {
      config = await this.prisma.recordingConfig.create({
        data: { courseId, isEnabled: true },
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

    // Log activity
    this.activityLog.record({
      sessionId: updated.sessionId,
      userId: updated.studentId,
      action: ActivityAction.RECORDING_SEGMENT_UPLOADED,
      courseId: updated.courseId,
      metadata: { segmentId, fileSizeBytes: dto.fileSizeBytes, durationMs: dto.durationMs },
    });

    // If py-feat is enabled for this course, auto-enqueue a processing job
    try {
      const pyfeatConfig = await this.pyfeatService.getConfig(updated.courseId);
      if (pyfeatConfig.isEnabled) {
        const job = await this.pyfeatService.enqueueJob({
          studentId: updated.studentId,
          sessionId: updated.sessionId,
          courseId: updated.courseId,
          sourceMinioKey: updated.minioKey,
          clipStartWallTime: updated.startWallTime.toISOString(),
        });
        await this.prisma.recordingSegment.update({
          where: { id: updated.id },
          data: { pyfeatJobId: job.id },
        });
        this.logger.log(`Auto-enqueued py-feat job ${job.id} for segment ${segmentId}`);
      }
    } catch (err) {
      this.logger.warn(`Failed to enqueue py-feat job for segment ${segmentId}: ${err}`);
    }

    // Enqueue OpenFace 3 if enabled for this course
    try {
      const recordingConfig = await this.getConfig(updated.courseId);
      if (recordingConfig.openface3Enabled && recordingConfig.openface3RunOnNewSegments) {
        await this.openface3Service.enqueueJob({
          recordingSegmentId: updated.id,
          sessionId: updated.sessionId,
          studentId: updated.studentId,
          courseId: updated.courseId,
          minioKey: updated.minioKey,
          segmentStartWallMs: updated.startWallTime.getTime(),
          extractionFps: recordingConfig.openface3ExtractionFps,
          detectorBackend: recordingConfig.openface3DetectorBackend,
        });
      } else {
        this.logger.debug(
          `openface3.enqueue.skipped: course=${updated.courseId} enabled=${recordingConfig.openface3Enabled} autoRun=${recordingConfig.openface3RunOnNewSegments}`,
        );
      }
    } catch (err) {
      this.logger.warn(`Failed to enqueue OpenFace 3 job for segment ${segmentId}: ${err}`);
    }

    return updated;
  }

  async failSegment(segmentId: string, error: string): Promise<void> {
    const segment = await this.prisma.recordingSegment.update({
      where: { id: segmentId },
      data: { uploadStatus: 'FAILED' },
    });
    this.logger.warn(`Segment ${segmentId} failed: ${error}`);

    this.activityLog.record({
      sessionId: segment.sessionId,
      userId: segment.studentId,
      action: ActivityAction.RECORDING_UPLOAD_FAILED,
      courseId: segment.courseId,
      metadata: { segmentId, error },
    });
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
