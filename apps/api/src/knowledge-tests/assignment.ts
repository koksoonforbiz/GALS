import { createHash } from 'crypto';

/**
 * Counterbalancing (docs/assessments/README.md §Counterbalancing).
 *
 * - Study tests: one of the six orders of A, B, C for (baseline, post-study,
 *   delayed follow-up), from an RNG seeded on (studentId, courseId) so the
 *   assignment is deterministic and re-running is idempotent. The third form
 *   is stored for a delayed test that is not built yet.
 * - Session tests: A-before/B-after or B-before/A-after, alternating by
 *   enrolment order (within condition), and alternating again across
 *   sessions so a student does not always meet the same form first.
 *
 * TODO(condition): the enrolment has no experimental-condition field yet,
 * so nothing is stratified. When one is added, rank students within their
 * condition and seed the study order on (studentId, courseId, condition).
 */

export const STUDY_ORDERS = ['ABC', 'ACB', 'BAC', 'BCA', 'CAB', 'CBA'] as const;

/** Deterministic integer from a seed string (first 48 bits of SHA-256). */
export function seededInt(seed: string): number {
  return parseInt(createHash('sha256').update(seed).digest('hex').slice(0, 12), 16);
}

export function studyOrder(studentId: string, courseId: string): (typeof STUDY_ORDERS)[number] {
  return STUDY_ORDERS[seededInt(`${studentId}:${courseId}:study`) % STUDY_ORDERS.length]!;
}

/** `rank` = 0-based enrolment order of the student in the course. */
export function sessionOrder(rank: number, sessionNo: number): 'AB' | 'BA' {
  return (rank + sessionNo) % 2 === 0 ? 'AB' : 'BA';
}

export interface PlannedAssignment {
  kind: 'PRE_STUDY' | 'POST_STUDY' | 'PRE_SESSION' | 'POST_SESSION';
  sessionNo: number; // 0 for study
  form: 'A' | 'B' | 'C';
  order: string;
}

/** The 18 assignments of one student (2 study + 2 × 8 session). */
export function planAssignments(
  studentId: string,
  courseId: string,
  rank: number,
): PlannedAssignment[] {
  const so = studyOrder(studentId, courseId);
  const out: PlannedAssignment[] = [
    { kind: 'PRE_STUDY', sessionNo: 0, form: so[0] as 'A' | 'B' | 'C', order: so },
    { kind: 'POST_STUDY', sessionNo: 0, form: so[1] as 'A' | 'B' | 'C', order: so },
  ];
  for (let n = 1; n <= 8; n++) {
    const o = sessionOrder(rank, n);
    out.push({ kind: 'PRE_SESSION', sessionNo: n, form: o[0] as 'A' | 'B', order: o });
    out.push({ kind: 'POST_SESSION', sessionNo: n, form: o[1] as 'A' | 'B', order: o });
  }
  return out;
}
