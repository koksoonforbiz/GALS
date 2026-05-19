import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import type { WebgazerConfig, WebgazerLog, WebgazerCalibrationEvent } from '@prisma/client';
import type { WebgazerConfigDto } from './dto/webgazer-config.dto';
import type { CreateGazeLogDto } from './dto/create-gaze-log.dto';
import type { CalibrationEventDto } from './dto/calibration-event.dto';

@Injectable()
export class WebgazerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
  ) {}

  async getConfig(courseId: string): Promise<WebgazerConfig> {
    let config = await this.prisma.webgazerConfig.findUnique({ where: { courseId } });
    if (!config) {
      config = await this.prisma.webgazerConfig.create({
        data: {
          courseId,
          isEnabled: true,
          calibrationOnNewSession: true,
          inactivityTimeoutSecs: 300,
          recalibrationEnabled: true,
        },
      });
    }
    return config;
  }

  async updateConfig(courseId: string, dto: WebgazerConfigDto): Promise<WebgazerConfig> {
    return this.prisma.webgazerConfig.upsert({
      where: { courseId },
      update: {
        isEnabled: dto.isEnabled,
        calibrationOnNewSession: dto.calibrationOnNewSession,
        recalibrationEnabled: dto.recalibrationEnabled,
        inactivityTimeoutSecs: dto.inactivityTimeoutSecs,
      },
      create: {
        courseId,
        isEnabled: dto.isEnabled,
        calibrationOnNewSession: dto.calibrationOnNewSession,
        recalibrationEnabled: dto.recalibrationEnabled,
        inactivityTimeoutSecs: dto.inactivityTimeoutSecs,
      },
    });
  }

  async bulkCreateLogs(
    studentId: string,
    sessionId: string,
    courseId: string,
    readings: CreateGazeLogDto[],
  ): Promise<void> {
    await this.prisma.webgazerLog.createMany({
      data: readings.map((r) => ({
        studentId,
        sessionId,
        courseId,
        timestamp: new Date(r.timestamp),
        gazeX: r.gazeX,
        gazeY: r.gazeY,
        confidence: r.confidence ?? null,
        pageUrl: r.pageUrl ?? null,
      })),
    });
  }

  async recordCalibrationEvent(
    studentId: string,
    dto: CalibrationEventDto,
  ): Promise<WebgazerCalibrationEvent> {
    return this.prisma.webgazerCalibrationEvent.create({
      data: {
        studentId,
        sessionId: dto.sessionId,
        courseId: dto.courseId,
        triggeredBy: dto.triggeredBy,
        completedAt: dto.completedAt ? new Date(dto.completedAt) : null,
        accuracy: dto.accuracy ?? null,
      },
    });
  }

  async getLogs(
    studentId: string,
    courseId: string,
    filters?: { sessionId?: string; from?: Date; to?: Date },
  ): Promise<WebgazerLog[]> {
    return this.prisma.webgazerLog.findMany({
      where: {
        studentId,
        courseId,
        ...(filters?.sessionId ? { sessionId: filters.sessionId } : {}),
        ...(filters?.from || filters?.to
          ? {
              timestamp: {
                ...(filters.from ? { gte: filters.from } : {}),
                ...(filters.to ? { lte: filters.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: 5000,
    });
  }

  async exportSessionCsv(studentId: string, sessionId: string): Promise<string> {
    const logs = await this.prisma.webgazerLog.findMany({
      where: { studentId, sessionId },
      orderBy: { timestamp: 'asc' },
    });

    const header = 'studentId,sessionId,courseId,timestamp,gazeX,gazeY,confidence,pageUrl';
    const rows = logs.map(
      (l) =>
        `${l.studentId},${l.sessionId},${l.courseId},${l.timestamp.toISOString()},${l.gazeX},${l.gazeY},${l.confidence ?? ''},${l.pageUrl ?? ''}`,
    );
    const csv = [header, ...rows].join('\n');

    const key = `webgazer/${studentId}/${sessionId}/gaze.csv`;
    await this.blob.put({ key, body: csv, contentType: 'text/csv' });

    return this.blob.getPresignedDownloadUrl({ key, expiresIn: 3600 });
  }

  async getCalibrationHistory(
    studentId: string,
    courseId: string,
  ): Promise<WebgazerCalibrationEvent[]> {
    return this.prisma.webgazerCalibrationEvent.findMany({
      where: { studentId, courseId },
      orderBy: { createdAt: 'desc' },
    });
  }
}
