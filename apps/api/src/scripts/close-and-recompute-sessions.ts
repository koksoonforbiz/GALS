/**
 * One-off admin script (Prompt B, P2): close the sessions that were never
 * closed and parse every session that has never been parsed.
 *
 *   1. Open sessions with no learner input for T2 (30 min) are closed, dated
 *      at their last input, reason idle_timeout (or tab_closed when the last
 *      thing seen was PAGE_LEFT). Same rules as the running sweeper, without
 *      its per-sweep cap.
 *   2. Closed sessions with no session_parse_runs row are parsed (trigger
 *      `recompute`), and their capture-quality records are written.
 *
 * Dry run first (counts only, changes nothing):
 *   local:  pnpm --filter @ats/api exec ts-node src/scripts/close-and-recompute-sessions.ts --dry-run
 *   server: docker compose exec api node dist/scripts/close-and-recompute-sessions.js --dry-run
 * Then without --dry-run. On lithium: only after a database backup, and only
 * when the PI says so (see docs/process-mining/audit/PLAN_B.md).
 */
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../app.module';
import { PrismaService } from '../prisma/prisma.service';
import { SessionTimeoutSweeper } from '../activity-log/session-timeout.sweeper';
import { CaptureQualityService } from '../activity-log/capture-quality.service';
import { LearningEventsService } from '../learning-events/learning-events.service';

async function main() {
  const dryRun = process.argv.includes('--dry-run');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const prisma = app.get(PrismaService);
    const sweeper = app.get(SessionTimeoutSweeper);
    const parser = app.get(LearningEventsService);
    const quality = app.get(CaptureQualityService);

    const open = await prisma.studentSession.count({ where: { endedAt: null } });
    console.log(`open sessions: ${open}`);
    let closed = 0;
    if (!dryRun) {
      // The sweeper closes at most 50 per call; repeat until none is left.
      for (let n = await sweeper.sweep(); n > 0; n = await sweeper.sweep()) closed += n;
    }
    console.log(`closed now (idle for T2 or more): ${dryRun ? '(dry run)' : closed}`);

    const unparsed = await prisma.$queryRaw<Array<{ id: string }>>`
      SELECT s.id FROM student_sessions s
      WHERE s.ended_at IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM session_parse_runs r WHERE r.session_id = s.id AND r.status = 'ok')
      ORDER BY s.started_at`;
    console.log(`closed sessions never parsed: ${unparsed.length}`);
    if (dryRun) return;
    let ok = 0;
    let failed = 0;
    for (const { id } of unparsed) {
      const r = await parser.parseWithRun(id, 'recompute');
      await quality.analyseSession(id).catch(() => undefined);
      if (r) ok++;
      else failed++;
    }
    console.log(`parsed: ${ok}, failed: ${failed} (see session_parse_runs.error)`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
