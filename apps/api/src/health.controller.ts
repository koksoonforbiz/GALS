import { Controller, Get, HttpStatus, Res } from '@nestjs/common';
import type { Response } from 'express';
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

  // Answers 503 when any dependency is down so HTTP-status-only probes
  // (the compose healthcheck, uptime monitors) see the failure — before
  // this a DB outage still returned 200 with status: 'degraded' in the
  // body, and the container stayed "healthy" (two-door rehearsal).
  @Get()
  async check(@Res({ passthrough: true }) res: Response) {
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
    if (!allOk) res.status(HttpStatus.SERVICE_UNAVAILABLE);

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
