import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { BlobService } from '../blob/blob.service';
import type { PupilSizeConfig, PupilSizeLog } from '@prisma/client';
import type { PupilSizeConfigDto } from './dto/pupil-size-config.dto';
import type { CreatePupilLogDto } from './dto/create-pupil-log.dto';

@Injectable()
export class PupilSizeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
  ) {}

  async getConfig(courseId: string): Promise<PupilSizeConfig> {
    let config = await this.prisma.pupilSizeConfig.findUnique({ where: { courseId } });
    if (!config) {
      config = await this.prisma.pupilSizeConfig.create({
        data: { courseId, isEnabled: false },
      });
    }
    return config;
  }

  async updateConfig(courseId: string, dto: PupilSizeConfigDto): Promise<PupilSizeConfig> {
    return this.prisma.pupilSizeConfig.upsert({
      where: { courseId },
      update: { isEnabled: dto.isEnabled },
      create: { courseId, isEnabled: dto.isEnabled },
    });
  }

  async bulkCreateLogs(
    studentId: string,
    sessionId: string,
    courseId: string,
    readings: CreatePupilLogDto[],
  ): Promise<void> {
    await this.prisma.pupilSizeLog.createMany({
      data: readings.map((r) => ({
        studentId,
        sessionId,
        courseId,
        timestamp: new Date(r.timestamp),
        pupilDiameter: r.pupilDiameter,
        rawData: (r.rawData as any) ?? undefined,
      })),
    });
  }

  async getLogsForStudent(
    studentId: string,
    courseId: string,
    options?: { from?: Date; to?: Date },
  ): Promise<PupilSizeLog[]> {
    return this.prisma.pupilSizeLog.findMany({
      where: {
        studentId,
        courseId,
        ...(options?.from || options?.to
          ? {
              timestamp: {
                ...(options.from ? { gte: options.from } : {}),
                ...(options.to ? { lte: options.to } : {}),
              },
            }
          : {}),
      },
      orderBy: { timestamp: 'desc' },
      take: 5000,
    });
  }

  async exportSessionCsv(studentId: string, sessionId: string): Promise<string> {
    const logs = await this.prisma.pupilSizeLog.findMany({
      where: { studentId, sessionId },
      orderBy: { timestamp: 'asc' },
    });

    const header = 'studentId,sessionId,courseId,timestamp,pupilDiameter,rawData';
    const rows = logs.map(
      (l) =>
        `${l.studentId},${l.sessionId},${l.courseId},${l.timestamp.toISOString()},${l.pupilDiameter},${l.rawData ? JSON.stringify(l.rawData) : ''}`,
    );
    const csv = [header, ...rows].join('\n');

    const key = `pupil-size/${studentId}/${sessionId}/pupil_size.csv`;
    await this.blob.put({ key, body: csv, contentType: 'text/csv' });

    return this.blob.getPresignedDownloadUrl({ key, expiresIn: 3600 });
  }
}
