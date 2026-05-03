import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { DetectionService } from './detection/detection.service';
import { CONSTRUCTS } from './detection/constructs';

@Injectable()
export class TextMiningService implements OnModuleInit {
  private readonly logger = new Logger(TextMiningService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly detection: DetectionService,
  ) {}

  async onModuleInit() {
    await this.detection.seedDefaultPrompts();
  }

  async ingest(args: {
    messageId: string;
    sessionId: string;
    studentId: string;
    courseId: string | null;
    teacherId: string;
    utterance: string;
  }): Promise<void> {
    // Check if paused
    const settings = await this.prisma.efTeacherSettings.findUnique({
      where: { teacherId: args.teacherId },
    });
    if (settings?.pauseIngestion) return;

    // Determine enabled constructs
    const enabledConstructs = settings?.disableLowFeasibility
      ? CONSTRUCTS.filter((c) => c.feasibility > 2)
      : CONSTRUCTS;

    // Insert placeholder rows so the dashboard knows work is in flight
    await this.prisma.efDetection.createMany({
      data: enabledConstructs.map((c) => ({
        messageId: args.messageId,
        sessionId: args.sessionId,
        studentId: args.studentId,
        courseId: args.courseId,
        constructKey: c.key,
        label: 'pending',
        provider: 'pending',
        model: 'pending',
        promptVersion: 0,
      })),
    });

    // Fire detection on next microtask
    queueMicrotask(() => {
      this.detection
        .detectAllForMessage(args)
        .then(async () => {
          // Replace placeholder rows with real results
          await this.prisma.efDetection.deleteMany({
            where: {
              messageId: args.messageId,
              label: 'pending',
            },
          });
        })
        .catch((err) => {
          this.logger.error(`Detection failed for message ${args.messageId}`, err);
        });
    });
  }
}
