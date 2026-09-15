import { Module } from '@nestjs/common';
import { APP_GUARD, APP_FILTER } from '@nestjs/core';
import { GlobalExceptionFilter, DoorGuard } from './common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
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
import { CourseModulesModule } from './modules';
import { RagModule } from './rag';
import { CourseStructureModule } from './course-structure';
import { PageContentModule } from './page-content';
import { EvaluationModule } from './evaluation';
import { LearningInterventionsModule } from './learning-interventions';
import { CodeDecompositionModule } from './code-decomposition/code-decomposition.module';
import { QuestionGenerationModule } from './question-generation';
import { UserManagementModule } from './user-management';
import { StudentRagModule } from './student-rag';
import { DialogueModule } from './dialogue';
import { DialogueNotesModule } from './dialogue-notes';
import { ActivityLogModule } from './activity-log';
import { RecordingModule } from './recording';
import { PupilSizeModule } from './pupil-size';
import { WebgazerModule } from './webgazer';
import { PyfeatModule } from './pyfeat';
import { LogsModule } from './logs';
import { AnalyticsModule } from './analytics';
import { JobsModule } from './jobs';
import { TextMiningModule } from './text-mining';
import { Openface3Module } from './openface3';
import { AffectiveMappingModule } from './affective-mapping';
import { ReplayAnnotationsModule } from './replay-annotations';
import { ChatHistoryModule } from './chat-history';
import { LlmModelsModule } from './llm';
import { PreGenerationModule } from './pre-generation/pre-generation.module';
import { VlmModule } from './vlm/vlm.module';
import { HealthController } from './health.controller';
import { ThrottlerRedisStorage } from './common/throttle-redis.storage';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
    }),
    ThrottlerModule.forRoot({
      throttlers: [{ ttl: 60000, limit: 30 }],
      storage: new ThrottlerRedisStorage(),
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
    CourseModulesModule,
    RagModule,
    CourseStructureModule,
    PageContentModule,
    EvaluationModule,
    LearningInterventionsModule,
    CodeDecompositionModule,
    QuestionGenerationModule,
    UserManagementModule,
    StudentRagModule,
    DialogueModule,
    DialogueNotesModule,
    ActivityLogModule,
    RecordingModule,
    PupilSizeModule,
    WebgazerModule,
    PyfeatModule,
    LogsModule,
    AnalyticsModule,
    JobsModule,
    TextMiningModule,
    Openface3Module,
    AffectiveMappingModule,
    ReplayAnnotationsModule,
    ChatHistoryModule,
    LlmModelsModule,
    PreGenerationModule,
    VlmModule,
  ],
  controllers: [HealthController],
  providers: [
    // Checklist item 16 — critical fix. `ThrottlerModule.forRoot()`
    // only registers the options/storage providers; it does NOT bind
    // `ThrottlerGuard` anywhere (confirmed by reading the installed
    // package's source — no `APP_GUARD` in throttler.module.js). Without
    // this, NEITHER the global 30/60s default NOR any per-route
    // `@Throttle()` decorator across the entire app actually runs —
    // they're inert metadata until something reads it via the guard.
    // Only `auth.controller.ts` and `code-decomposition.controller.ts`
    // were protected (they each apply `ThrottlerGuard` per-controller);
    // every other controller — including every `@Throttle()` added
    // this pass to rag/question-generation/activity-log/jobs — had NO
    // rate limiting in effect at all.
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Two-door split (docs/two-door/, Phase 4) — refuses PRIVATE routes
    // that arrive through the public student door (X-GALS-Door: public,
    // set by nginx). Defence in depth behind the nginx allowlist; a no-op
    // for requests that did not come through a door (dev on :3000, tests).
    { provide: APP_GUARD, useClass: DoorGuard },
    // Checklist item 25 — moved from a manual `app.useGlobalFilters(new
    // GlobalExceptionFilter())` in main.ts to APP_FILTER so it's
    // DI-managed and can inject SecurityEventService (AuthModule is
    // @Global(), so this resolves without importing it here directly)
    // to record every 5xx into the queryable security_events table.
    { provide: APP_FILTER, useClass: GlobalExceptionFilter },
  ],
})
export class AppModule {}
