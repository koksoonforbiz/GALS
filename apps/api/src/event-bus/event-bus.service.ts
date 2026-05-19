import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma';

interface EventRow {
  id: string;
  topic: string;
  payload: unknown;
}

@Injectable()
export class EventBusService {
  private readonly logger = new Logger(EventBusService.name);

  constructor(private readonly prisma: PrismaService) {}

  async publish(topic: string, payload: unknown): Promise<void> {
    await this.prisma.eventQueue.create({
      data: { topic, payload: payload as object },
    });
    this.logger.log(`Published event: ${topic}`);
  }

  async pollAndProcess(
    topic: string,
    handler: (event: EventRow) => Promise<void>,
  ): Promise<boolean> {
    const events = await this.prisma.$queryRaw<EventRow[]>`
      UPDATE event_queue
      SET status = 'processing'
      WHERE id = (
        SELECT id FROM event_queue
        WHERE topic = ${topic} AND status = 'pending'
        ORDER BY created_at
        LIMIT 1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING id, topic, payload
    `;

    const event = events[0];
    if (!event) {
      return false;
    }

    try {
      await handler(event);
      await this.prisma.eventQueue.update({
        where: { id: event.id },
        data: { status: 'processed', processedAt: new Date() },
      });
      this.logger.log(`Processed event: ${topic} (${event.id})`);
      return true;
    } catch (err) {
      await this.prisma.eventQueue.update({
        where: { id: event.id },
        data: { status: 'failed' },
      });
      this.logger.error(`Failed to process event: ${topic} (${event.id})`, err);
      return false;
    }
  }

  async isHealthy(): Promise<boolean> {
    try {
      await this.prisma.$queryRaw`SELECT 1 FROM event_queue LIMIT 0`;
      return true;
    } catch {
      return false;
    }
  }
}
