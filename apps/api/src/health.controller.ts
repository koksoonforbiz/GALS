import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma';
import { BlobService } from './blob';
import { EventBusService } from './event-bus';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
    private readonly eventBus: EventBusService,
  ) {}

  @Get()
  async check() {
    let dbStatus = 'ok';
    try {
      await this.prisma.$queryRaw`SELECT 1`;
    } catch {
      dbStatus = 'error';
    }

    let blobStatus = 'ok';
    try {
      const healthy = await this.blob.isHealthy();
      if (!healthy) blobStatus = 'error';
    } catch {
      blobStatus = 'error';
    }

    let eventBusStatus = 'ok';
    try {
      const healthy = await this.eventBus.isHealthy();
      if (!healthy) eventBusStatus = 'error';
    } catch {
      eventBusStatus = 'error';
    }

    const allOk = dbStatus === 'ok' && blobStatus === 'ok' && eventBusStatus === 'ok';

    return {
      status: allOk ? 'ok' : 'degraded',
      service: 'api',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbStatus,
        blobStorage: blobStatus,
        eventBus: eventBusStatus,
      },
    };
  }
}
