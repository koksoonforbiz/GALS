import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class TeacherSettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getSettings(teacherId: string) {
    let settings = await this.prisma.efTeacherSettings.findUnique({
      where: { teacherId },
    });
    if (!settings) {
      settings = await this.prisma.efTeacherSettings.create({
        data: { teacherId },
      });
    }
    return settings;
  }

  async updateSettings(
    teacherId: string,
    data: Partial<{
      rollingWindowN: number;
      detectionConcurrency: number;
      disableLowFeasibility: boolean;
      pauseIngestion: boolean;
      detectionProviderOverride: string | null;
      detectionModelOverride: string | null;
    }>,
  ) {
    return this.prisma.efTeacherSettings.upsert({
      where: { teacherId },
      update: data,
      create: { teacherId, ...data },
    });
  }
}
