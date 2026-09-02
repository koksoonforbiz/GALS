import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma';
import { GlobalExceptionFilter } from '../common';

export async function createTestApp(): Promise<{
  app: INestApplication;
  prisma: PrismaService;
}> {
  const moduleFixture: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
  }).compile();

  const app = moduleFixture.createNestApplication();
  app.setGlobalPrefix('api');
  app.useGlobalFilters(new GlobalExceptionFilter());
  await app.init();

  const prisma = app.get(PrismaService);

  return { app, prisma };
}

/**
 * Hard-stop guard against ever wiping a non-test database. This exists
 * because of a real incident (2026-09-02): running the suite via a bare
 * `npx jest` instead of the `test` npm script (which loads `.env.test`
 * via `dotenv -e .env.test --`) let Prisma fall back to `apps/api/.env`
 * — the REAL dev database — and this file's `afterEach(cleanDatabase)`
 * hooks silently deleted every course, user, and enrollment in it, with
 * no soft-delete or backup to recover from. `cleanDatabase()` must
 * NEVER run unless both signals unambiguously point at the isolated
 * test database — checking only one (e.g. just NODE_ENV) leaves a gap
 * if that alone were ever misconfigured.
 */
function assertSafeToWipe(): void {
  const nodeEnv = process.env.NODE_ENV;
  const dbUrl = process.env.DATABASE_URL ?? '';
  // Matches a database name ending in "_test" (e.g. "ats_db_test") —
  // verified against both `.env.test`'s real value and the dev `.env`'s
  // "ats_db" to confirm it actually discriminates between them.
  const looksLikeTestDb = /_test(?:[/?]|$)/i.test(dbUrl);
  if (nodeEnv !== 'test' || !looksLikeTestDb) {
    throw new Error(
      'cleanDatabase() refused to run: this does not look like the isolated test database ' +
        `(NODE_ENV="${nodeEnv}", DATABASE_URL="${dbUrl.replace(/:[^:@]+@/, ':***@')}"). ` +
        'Run tests via `pnpm test` (which loads .env.test), not a bare `npx jest`.',
    );
  }
}

export async function cleanDatabase(prisma: PrismaService): Promise<void> {
  assertSafeToWipe();
  // Delete in reverse dependency order
  await prisma.kcGraphLayout.deleteMany();
  await prisma.publishGateRun.deleteMany();
  await prisma.knowledgeVersion.deleteMany();
  await prisma.curriculumCoverageRun.deleteMany();
  await prisma.kcEvidence.deleteMany();
  await prisma.userMastery.deleteMany();
  await prisma.gradingResult.deleteMany();
  await prisma.attempt.deleteMany();
  await prisma.assessmentQuestion.deleteMany();
  await prisma.assessment.deleteMany();
  await prisma.questionKc.deleteMany();
  await prisma.knowledgeComponent.deleteMany();
  await prisma.question.deleteMany();
  await prisma.topic.deleteMany();
  await prisma.enrollment.deleteMany();
  await prisma.course.deleteMany();
  await prisma.eventQueue.deleteMany();
  await prisma.user.deleteMany();
}
