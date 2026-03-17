import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { CourseModulesModule } from './modules';
import { RagModule } from './rag';
import { CourseStructureModule } from './course-structure';
import { PageContentModule } from './page-content';
import { EvaluationModule } from './evaluation';
import { KcModule } from './kc';
import { KcEvaluationModule } from './kc-evaluation';
import { CurriculumCoverageModule } from './curriculum-coverage';
import { KnowledgeVersionModule } from './knowledge-version';
import { PublishGateModule } from './publish-gate';
import { LearningInterventionsModule } from './learning-interventions';
import { QuestionGenerationModule } from './question-generation';
import { UserManagementModule } from './user-management';
import { StudentRagModule } from './student-rag';
import { DialogueModule } from './dialogue';
import { ActivityLogModule } from './activity-log';
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
    MasteryModule,
    CourseModulesModule,
    RagModule,
    CourseStructureModule,
    PageContentModule,
    EvaluationModule,
    KcModule,
    KcEvaluationModule,
    CurriculumCoverageModule,
    KnowledgeVersionModule,
    PublishGateModule,
    LearningInterventionsModule,
    QuestionGenerationModule,
    UserManagementModule,
    StudentRagModule,
    DialogueModule,
    ActivityLogModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
