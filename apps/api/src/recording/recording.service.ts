import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  Inject,
  forwardRef,
} from '@nestjs/common';
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

  /** Verifies `teacherId` teaches `courseId`. Throws ForbiddenException otherwise. */
  private async assertTeacherOwnsCourse(courseId: string, teacherId: string): Promise<void> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only access your own courses');
    }
  }

  /** Verifies `studentId` is enrolled in `courseId`. Throws ForbiddenException otherwise. */
  private async assertStudentEnrolled(courseId: string, studentId: string): Promise<void> {
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
    });
    if (!enrollment) {
      throw new ForbiddenException('You are not enrolled in this course');
    }
  }

  async getConfig(
    courseId: string,
    requester: { id: string; role: string },
  ): Promise<RecordingConfig> {
    if (requester.role === 'teacher') {
      await this.assertTeacherOwnsCourse(courseId, requester.id);
    } else {
      await this.assertStudentEnrolled(courseId, requester.id);
    }
    return this.getOrCreateConfig(courseId);
  }

  /** Internal, unchecked variant for server-side callers that already hold a valid courseId. */
  private async getOrCreateConfig(courseId: string): Promise<RecordingConfig> {
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

  async updateConfig(
    courseId: string,
    teacherId: string,
    dto: RecordingConfigDto,
  ): Promise<RecordingConfig> {
    await this.assertTeacherOwnsCourse(courseId, teacherId);

    // Patch only the fields the caller provided. This lets a focused form
    // (e.g. OpenFace3 settings) update its own subset without clobbering
    // the webcam-recording toggle or vice versa.
    const update: Record<string, unknown> = {};
    if (dto.isEnabled !== undefined) update.isEnabled = dto.isEnabled;
    if (dto.openface3Enabled !== undefined) update.openface3Enabled = dto.openface3Enabled;
    if (dto.openface3ExtractionFps !== undefined)
      update.openface3ExtractionFps = dto.openface3ExtractionFps;
    if (dto.openface3DetectorBackend !== undefined)
      update.openface3DetectorBackend = dto.openface3DetectorBackend;
    if (dto.openface3RunOnNewSegments !== undefined)
      update.openface3RunOnNewSegments = dto.openface3RunOnNewSegments;

    return this.prisma.recordingConfig.upsert({
      where: { courseId },
      update,
      create: {
        courseId,
        isEnabled: dto.isEnabled ?? false,
        ...(dto.openface3Enabled !== undefined && { openface3Enabled: dto.openface3Enabled }),
        ...(dto.openface3ExtractionFps !== undefined && {
          openface3ExtractionFps: dto.openface3ExtractionFps,
        }),
        ...(dto.openface3DetectorBackend !== undefined && {
          openface3DetectorBackend: dto.openface3DetectorBackend,
        }),
        ...(dto.openface3RunOnNewSegments !== undefined && {
          openface3RunOnNewSegments: dto.openface3RunOnNewSegments,
        }),
      },
    });
  }

  async initiateSegment(
    studentId: string,
    dto: CreateSegmentDto,
  ): Promise<{ segmentId: string; uploadUrl: string; minioKey: string }> {
    await this.assertStudentEnrolled(dto.courseId, studentId);

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

  async completeSegment(
    segmentId: string,
    studentId: string,
    dto: CompleteSegmentDto,
  ): Promise<RecordingSegment> {
    const segment = await this.prisma.recordingSegment.findUnique({
      where: { id: segmentId },
    });
    if (!segment) throw new NotFoundException('Segment not found');
    if (segment.studentId !== studentId) {
      throw new ForbiddenException('You can only update your own recording segments');
    }

    const objectExists = await this.blob.exists(segment.minioKey);
    if (!objectExists) {
      await this.prisma.recordingSegment.update({
        where: { id: segmentId },
        data: { uploadStatus: 'FAILED' },
      });
      this.activityLog.record({
        sessionId: segment.sessionId,
        userId: segment.studentId,
        action: ActivityAction.RECORDING_UPLOAD_FAILED,
        courseId: segment.courseId,
        metadata: { segmentId, error: 'Object missing in blob storage at completion time' },
      });
      throw new NotFoundException('Uploaded recording object not found in blob storage');
    }

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
      const recordingConfig = await this.getOrCreateConfig(updated.courseId);
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

  async failSegment(segmentId: string, studentId: string, error: string): Promise<void> {
    const existing = await this.prisma.recordingSegment.findUnique({
      where: { id: segmentId },
      select: { studentId: true },
    });
    if (!existing) throw new NotFoundException('Segment not found');
    if (existing.studentId !== studentId) {
      throw new ForbiddenException('You can only update your own recording segments');
    }

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

  async getSegments(
    studentId: string,
    courseId: string,
    teacherId: string,
  ): Promise<RecordingSegment[]> {
    await this.assertTeacherOwnsCourse(courseId, teacherId);
    return this.prisma.recordingSegment.findMany({
      where: { studentId, courseId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async getDownloadUrl(segmentId: string, teacherId: string): Promise<string> {
    const segment = await this.prisma.recordingSegment.findUnique({
      where: { id: segmentId },
      include: { course: { select: { teacherId: true } } },
    });
    if (!segment) throw new NotFoundException('Segment not found');
    if (segment.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only access recordings from your own courses');
    }

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
