import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { EfaTaskRun, Prisma } from '@prisma/client';
import type { PuzzleStepResponse, PuzzleStepSubmitRequest, PuzzleStepView } from '@ats/shared';
import { PrismaService } from '../prisma';
import { ActivityAction } from '../activity-log/activity-action.enum';
import { EfaOccasionService, type PuzzleOccasionView } from './occasion.service';
import { EfaScoringService } from './scoring/scoring.service';
import { advance, currentStep, isFinished, startProgress, type Progress } from './tasks/engine';
import { evaluateStep } from './tasks/evaluate';
import { stepView, taskSteps, type Step, type TaskCode } from './tasks/steps';

/**
 * Runs one puzzle (W1–W7) step by step. The browser gets one step at a
 * time (no answer keys); every result is re-scored here from the form's
 * stimuli, and the engine applies practice repeats and discontinue rules.
 * A run finishes automatically after its last step.
 */
@Injectable()
export class EfaTaskRunService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly occasions: EfaOccasionService,
    private readonly scoring: EfaScoringService,
  ) {}

  private async steps(occasion: { form: string | null }, task: TaskCode): Promise<Step[]> {
    const set = await this.occasions.stimulusSet();
    return taskSteps(task, set.data, occasion.form!, set.extras);
  }

  private view(steps: Step[], p: Progress): PuzzleStepView | null {
    const s = currentStep(steps, p);
    return s ? { ...stepView(s), attempt: p.attempt } : null;
  }

  /** Start the next puzzle. Only the puzzle that is due may be started. */
  async begin(studentId: string, occasionId: string, task: TaskCode, sessionId?: string) {
    const o = await this.occasions.ownOccasion(studentId, occasionId);
    this.occasions.assertOpen(o);
    const cfg = await this.occasions.config(o.courseId);
    const view = await this.occasions.view(studentId, o.courseId, o.occasion);
    if (view.next !== 'tasks' || view.task?.code !== task) {
      throw new ConflictException('This puzzle is not available right now.');
    }

    const latest = await this.prisma.efaTaskRun.findFirst({
      where: { occasionId, taskCode: task },
      orderBy: { attemptNo: 'desc' },
    });
    const steps = await this.steps(o, task);
    const progress = startProgress();
    const now = new Date();
    const data = {
      status: 'in_progress' as const,
      progress: progress as unknown as Prisma.InputJsonValue,
      startedAt: now,
    };
    let run: EfaTaskRun;
    if (latest && !latest.resetReason && latest.status === 'pending') {
      run = await this.prisma.efaTaskRun.update({ where: { id: latest.id }, data });
    } else {
      const attemptNo = (latest?.attemptNo ?? 0) + 1;
      run = await this.prisma.efaTaskRun.create({
        data: {
          occasionId,
          taskCode: task,
          attemptNo,
          ...data,
          ...(attemptNo > 1 ? { flags: { items_reexposed: true } } : {}),
        },
      });
    }
    await this.occasions.touch(
      occasionId,
      o.status === 'questionnaire_done' ? { status: 'in_progress' } : {},
    );
    await this.occasions.log(sessionId, studentId, o.courseId, ActivityAction.EF_TASK_STARTED, {
      occasion: o.occasion,
      task,
      attempt: run.attemptNo,
      ...(cfg.enabledTasks.length ? { of: cfg.enabledTasks.length } : {}),
    });
    return { runId: run.id, task, step: this.view(steps, progress) };
  }

  /** Accept one step's result; returns practice feedback and the next step (or the occasion view when done). */
  async submit(
    studentId: string,
    runId: string,
    dto: PuzzleStepSubmitRequest,
    sessionId?: string,
  ): Promise<PuzzleStepResponse & { done?: boolean; view?: PuzzleOccasionView }> {
    const run = await this.prisma.efaTaskRun.findUnique({
      where: { id: runId },
      include: { occasion: true },
    });
    if (!run || run.occasion.studentId !== studentId) throw new NotFoundException('Not found');
    const o = run.occasion;
    this.occasions.assertOpen(o);
    if (run.status !== 'in_progress') throw new ConflictException('This puzzle has already ended.');

    const steps = await this.steps(o, run.taskCode as TaskCode);
    const p = (run.progress as unknown as Progress) ?? startProgress();
    const step = currentStep(steps, p);
    if (!step || step.id !== dto.stepId || p.attempt !== dto.attempt) {
      throw new ConflictException('Out of step. Please continue from the current screen.');
    }
    if (step.kind !== dto.result.kind)
      throw new ConflictException('Unexpected result for this step.');

    const ev = evaluateStep(step, p.attempt, dto.result);
    const next = advance(steps, p, ev.correct);
    const finished = isFinished(steps, next);
    const focus = ev.rows.reduce((a, r) => a + (r.focusLostMs ?? 0), 0);

    await this.prisma.$transaction([
      this.prisma.efaTrial.createMany({
        data: ev.rows.map((r) => ({
          taskRunId: run.id,
          phase: r.phase,
          part: r.part,
          trialIndex: r.trialIndex,
          stimulus: r.stimulus as Prisma.InputJsonValue,
          response: (r.response ?? undefined) as Prisma.InputJsonValue | undefined,
          onsetMs: r.onsetMs ?? null,
          firstInputMs: r.firstInputMs ?? null,
          submitMs: r.submitMs ?? null,
          shownMs: (r.shownMs ?? undefined) as Prisma.InputJsonValue | undefined,
          corrections: r.corrections ?? 0,
          focusLostMs: r.focusLostMs ?? 0,
          correct: r.correct ?? null,
          clientTs: new Date(),
        })),
        skipDuplicates: true,
      }),
      this.prisma.efaTaskRun.update({
        where: { id: run.id },
        data: {
          progress: next as unknown as Prisma.InputJsonValue,
          ...(finished
            ? {
                status: 'completed',
                completedAt: new Date(),
                flags: {
                  ...((run.flags as object) ?? {}),
                  ...(next.discontinued.length ? { discontinued: next.discontinued } : {}),
                },
              }
            : {}),
        },
      }),
      this.prisma.efaOccasion.update({
        where: { id: o.id },
        data: {
          lastActivityAt: new Date(),
          ...(focus ? { focusLostMsTotal: { increment: BigInt(Math.round(focus)) } } : {}),
        },
      }),
    ]);

    if (!finished) return { feedback: ev.feedback, next: this.view(steps, next) };

    await this.scoring.scoreRunSafely(run.id);

    await this.occasions.log(sessionId, studentId, o.courseId, ActivityAction.EF_TASK_COMPLETED, {
      occasion: o.occasion,
      task: run.taskCode,
      attempt: run.attemptNo,
      durationMs: run.startedAt ? Date.now() - run.startedAt.getTime() : null,
    });
    return {
      feedback: ev.feedback,
      next: null,
      done: true,
      view: await this.occasions.view(studentId, o.courseId, o.occasion),
    };
  }
}
