import {
  KNOWLEDGE_TEST_SLUG,
  knowledgeTestLabel,
  parseKnowledgeTestOccasion,
  type KnowledgeTestStatusEntry,
} from '@ats/shared';

/**
 * Which knowledge tests a student may take now (pure; unit-tested).
 *
 * Course order comes from the course gates (a strict sequence: warm-up →
 * pre-study test → S1 pre → S1 lesson → S1 post → … → S8 post → post-study
 * test → post-study warm-up). A test is available when its gate is the
 * next one; a post-session test additionally needs that session's lesson
 * finished (its reflect slide saved).
 */

export interface StatusStep {
  gateId: string;
  kind: string; // CourseGateKind
  occasion: string | null;
  label: string;
  done: boolean;
  next: boolean;
}

export const REASON = {
  PREVIOUS_STEP: 'PREVIOUS_STEP',
  LESSON_NOT_FINISHED: 'LESSON_NOT_FINISHED',
  NOT_CONFIGURED: 'NOT_CONFIGURED',
  ALREADY_SUBMITTED: 'ALREADY_SUBMITTED',
} as const;

export function testStatus(
  steps: StatusStep[],
  attempts: ReadonlyMap<string, 'in_progress' | 'submitted'>,
  lessonFinished: (sessionNo: number) => boolean,
): KnowledgeTestStatusEntry[] {
  const out: KnowledgeTestStatusEntry[] = [];
  steps.forEach((step, i) => {
    if (step.kind !== 'KNOWLEDGE_TEST' || !step.occasion) return;
    const t = parseKnowledgeTestOccasion(step.occasion);
    if (!t) return;
    const base = {
      kind: t.kind,
      sessionNo: t.sessionNo,
      slug: KNOWLEDGE_TEST_SLUG[t.kind],
      label: knowledgeTestLabel(t.kind, t.sessionNo),
    };
    const attempt = attempts.get(step.occasion);
    if (step.done || attempt === 'submitted') {
      out.push({ ...base, state: 'submitted' });
      return;
    }
    if (!step.next) {
      const blocker = steps.slice(0, i).find((s) => !s.done);
      out.push({
        ...base,
        state: 'locked',
        reasonCode: REASON.PREVIOUS_STEP,
        reason: blocker
          ? `Complete “${blocker.label}” first.`
          : 'Complete the earlier steps first.',
      });
      return;
    }
    if (t.kind === 'POST_SESSION' && !lessonFinished(t.sessionNo!)) {
      out.push({
        ...base,
        state: 'locked',
        reasonCode: REASON.LESSON_NOT_FINISHED,
        reason: `Finish the Session ${t.sessionNo} lesson first (up to its reflection slide).`,
      });
      return;
    }
    out.push({ ...base, state: attempt === 'in_progress' ? 'in_progress' : 'available' });
  });
  return out;
}
