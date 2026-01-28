import { Controller, Get } from '@nestjs/common';
import { PrismaService } from './prisma';
import { BlobService } from './blob';

@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly blob: BlobService,
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

    const allOk = dbStatus === 'ok' && blobStatus === 'ok';

    return {
      status: allOk ? 'ok' : 'degraded',
      service: 'api',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbStatus,
        blobStorage: blobStatus,
      },
    };
  }
}
