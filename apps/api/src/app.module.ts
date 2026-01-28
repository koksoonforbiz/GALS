import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma';
import { BlobModule } from './blob';
import { EventBusModule } from './event-bus';
import { GradingModule } from './grading';
import { HealthController } from './health.controller';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    PrismaModule,
    BlobModule,
    EventBusModule,
    GradingModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
