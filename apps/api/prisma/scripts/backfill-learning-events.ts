/**
 * Recompute learning_events for every session of a course (plan Phase 4 #3:
 * "plus a backfill command"). Uses the same LearningEventsService as the
 * API, booted without HTTP.
 *
 *   pnpm run learning-events:backfill -- --course-id <uuid> [--parameter-set <version>]
 */
import { Module } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { PrismaModule } from '../../src/prisma';
import { LearningEventsCoreModule, LearningEventsService } from '../../src/learning-events';

@Module({ imports: [PrismaModule, LearningEventsCoreModule] })
class BackfillModule {}

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const courseId = arg('--course-id');
  if (!courseId) throw new Error('--course-id is required');
  const version = arg('--parameter-set');
  const app = await NestFactory.createApplicationContext(BackfillModule, {
    logger: ['error', 'warn'],
  });
  try {
    const res = await app
      .get(LearningEventsService)
      .computeCourse(courseId, version ? Number(version) : undefined);
    for (const r of res.results) {
      console.log(
        `${r.sessionId}: ${r.rawActions} raw (${r.duplicatesRemoved} duplicates removed) → ${r.learningEvents} learning events`,
        JSON.stringify(r.byRule),
      );
    }
    console.log(
      `Done: ${res.sessions} session(s), parameter set v${res.results[0]?.parameterSetVersion ?? '–'}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
