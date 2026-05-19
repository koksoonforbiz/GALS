import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventBusService } from '../event-bus';
import { GradingGateway } from './grading.gateway';
import { EventTopics, GradeCompletedPayloadSchema } from '@ats/shared';

@Injectable()
export class GradeCompletedPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GradeCompletedPoller.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly eventBus: EventBusService,
    private readonly gateway: GradingGateway,
  ) {}

  onModuleInit(): void {
    this.logger.log('Starting grade_completed event poller (2s interval)');
    this.intervalHandle = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error('Polling error', err);
      });
    }, 2000);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async poll(): Promise<void> {
    await this.eventBus.pollAndProcess(EventTopics.GRADE_COMPLETED, async (event) => {
      const parsed = GradeCompletedPayloadSchema.parse(event.payload);
      this.gateway.notifyGradeCompleted(parsed.studentId, parsed);
    });
  }
}
