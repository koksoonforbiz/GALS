import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma';
import { SCORING_VERSION, scoreTask, type FinalCodes, type ScoreTrial } from './scoring';

/**
 * Persists task scores (efa_task_scores, one row per run and
 * scoring_version). Scores are always recomputed from the raw trials plus
 * the final rater codes, so re-scoring never touches raw data and older
 * versions stay in the table.
 */
@Injectable()
export class EfaScoringService {
  private readonly logger = new Logger(EfaScoringService.name);

  constructor(private readonly prisma: PrismaService) {}

  /** Score one run (completed or interrupted). Returns null for runs without trials. */
  async scoreRun(runId: string, version = SCORING_VERSION) {
    const run = await this.prisma.efaTaskRun.findUnique({
      where: { id: runId },
      include: { trials: { include: { finalCodes: true } } },
    });
    if (!run || run.status === 'pending' || run.status === 'skipped') return null;

    const codes: FinalCodes = new Map();
    const trials: ScoreTrial[] = run.trials.map((t) => {
      for (const c of t.finalCodes) {
        codes.set(`${t.trialIndex}:${t.part}:${c.entryIndex}`, {
          code: c.code,
          category: c.category,
        });
      }
      return {
        phase: t.phase,
        part: t.part,
        trialIndex: t.trialIndex,
        stimulus: t.stimulus,
        response: t.response,
        onsetMs: t.onsetMs,
        firstInputMs: t.firstInputMs,
        submitMs: t.submitMs,
        correct: t.correct,
      };
    });
    const result = scoreTask(run.taskCode, trials, codes);
    const flags = {
      ...result.flags,
      ...(run.status !== 'completed' ? { run_status: run.status } : {}),
      ...((run.flags as Record<string, unknown> | null) ?? {}),
    };
    const data = {
      scores: result.scores as Prisma.InputJsonValue,
      flags: flags as Prisma.InputJsonValue,
      computedAt: new Date(),
    };
    await this.prisma.$transaction([
      this.prisma.efaTaskScore.upsert({
        where: { taskRunId_scoringVersion: { taskRunId: runId, scoringVersion: version } },
        create: { taskRunId: runId, scoringVersion: version, ...data },
        update: data,
      }),
      this.prisma.efaOccasion.update({
        where: { id: run.occasionId },
        data: { scoringVersion: version },
      }),
    ]);
    return result;
  }

  /** Scoring must never block a student: failures are logged and can be repaired by a re-score. */
  async scoreRunSafely(runId: string) {
    try {
      await this.scoreRun(runId);
    } catch (err) {
      this.logger.error(`Scoring run ${runId} failed: ${(err as Error).message}`);
    }
  }

  /** Recompute every finished or interrupted run of a course for the current version. */
  async rescoreCourse(courseId: string, version = SCORING_VERSION) {
    const runs = await this.prisma.efaTaskRun.findMany({
      where: { occasion: { courseId }, status: { in: ['completed', 'interrupted'] } },
      select: { id: true },
    });
    let scored = 0;
    for (const r of runs) if (await this.scoreRun(r.id, version)) scored++;
    return { scoringVersion: version, runs: runs.length, scored };
  }
}
