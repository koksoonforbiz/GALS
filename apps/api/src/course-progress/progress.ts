import type { CourseProgressStep, CourseSessionProgress } from '@ats/shared';

/**
 * Pure course-progress computation (no I/O, unit-tested).
 *
 * The course runs in module order: each module's BEFORE_MODULE gates, then
 * its session lesson (if it is a "Session N" module), then its
 * AFTER_MODULE gates. Same order as the gates' lock computation
 * (course-gates/lock-state.ts), with the lessons placed between them.
 */

export interface ProgressModule {
  id: string;
  title: string;
  orderIndex: number;
}

export interface ProgressGate {
  id: string;
  moduleId: string;
  position: 'BEFORE_MODULE' | 'AFTER_MODULE';
  sequence: number;
  step: 'questionnaire' | 'puzzles' | 'knowledge';
  label: string;
  occasion: string | null;
  done: boolean;
}

export interface ProgressLesson {
  sessionNo: number;
  moduleId: string;
  lessonItemId: string | null;
  finished: boolean;
  started: boolean;
}

export interface ProgressResult {
  steps: CourseProgressStep[];
  sessions: CourseSessionProgress[];
  done: number;
  total: number;
  next: CourseProgressStep | null;
}

export function computeCourseProgress(
  modules: ProgressModule[],
  gates: ProgressGate[],
  lessons: ProgressLesson[],
  lockedModuleIds: ReadonlySet<string>,
): ProgressResult {
  const ordered = [...modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const bySeq = (a: ProgressGate, b: ProgressGate) => a.sequence - b.sequence;
  const gateStep = (g: ProgressGate): CourseProgressStep => {
    const m = g.occasion ? /^S([1-8])_(PRE|POST)$/.exec(g.occasion) : null;
    return {
      kind: 'step',
      label: g.label,
      done: g.done,
      sessionNo: m ? Number(m[1]) : null,
      moduleItemId: null,
      step: g.step,
      occasion: g.occasion,
    };
  };

  const steps: CourseProgressStep[] = [];
  const sessions: CourseSessionProgress[] = [];
  for (const m of ordered) {
    const own = gates.filter((g) => g.moduleId === m.id);
    own
      .filter((g) => g.position === 'BEFORE_MODULE')
      .sort(bySeq)
      .forEach((g) => steps.push(gateStep(g)));
    const lesson = lessons.find((l) => l.moduleId === m.id);
    if (lesson?.lessonItemId) {
      steps.push({
        kind: 'lesson',
        label: `Session ${lesson.sessionNo} lesson`,
        done: lesson.finished,
        sessionNo: lesson.sessionNo,
        moduleItemId: lesson.lessonItemId,
        step: null,
        occasion: null,
      });
      sessions.push({
        sessionNo: lesson.sessionNo,
        title: m.title,
        state: lockedModuleIds.has(m.id)
          ? 'locked'
          : lesson.finished
            ? 'done'
            : lesson.started
              ? 'in_progress'
              : 'open',
      });
    }
    own
      .filter((g) => g.position === 'AFTER_MODULE')
      .sort(bySeq)
      .forEach((g) => steps.push(gateStep(g)));
  }

  const done = steps.filter((s) => s.done).length;
  return {
    steps,
    sessions: sessions.sort((a, b) => a.sessionNo - b.sessionNo),
    done,
    total: steps.length,
    next: steps.find((s) => !s.done) ?? null,
  };
}
