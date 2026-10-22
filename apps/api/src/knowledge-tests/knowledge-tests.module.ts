import { Module } from '@nestjs/common';
import { ActivityLogModule } from '../activity-log/activity-log.module';
import { CourseGatesModule } from '../course-gates';
import { KnowledgeTestAdminService } from './knowledge-test-admin.service';
import { KnowledgeTestService } from './knowledge-test.service';
import { KnowledgeTestsAdminController } from './knowledge-tests-admin.controller';
import { KnowledgeTestsController } from './knowledge-tests.controller';

/**
 * Knowledge tests (docs/assessments/README.md). Student routes
 * /api/knowledge-tests, staff routes /api/knowledge-tests-admin.
 */
@Module({
  imports: [ActivityLogModule, CourseGatesModule],
  controllers: [KnowledgeTestsController, KnowledgeTestsAdminController],
  providers: [KnowledgeTestService, KnowledgeTestAdminService],
  exports: [KnowledgeTestService],
})
export class KnowledgeTestsModule {}
