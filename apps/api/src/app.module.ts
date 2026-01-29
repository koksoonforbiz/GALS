import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma';
import { BlobModule } from './blob';
import { EventBusModule } from './event-bus';
import { GradingModule } from './grading';
import { AuthModule } from './auth';
import { CoursesModule } from './courses';
import { TopicsModule } from './topics';
import { QuestionsModule } from './questions';
import { AssessmentsModule } from './assessments';
import { EnrollmentsModule } from './enrollments';
import { AttemptsModule } from './attempts';
import { MasteryModule } from './mastery';
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
    AuthModule,
    CoursesModule,
    TopicsModule,
    QuestionsModule,
    AssessmentsModule,
    EnrollmentsModule,
    AttemptsModule,
    MasteryModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
