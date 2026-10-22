import { z } from 'zod';

/** Staff override of one course gate for one student (audited). */
export const GateUnlockSchema = z.object({
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
});
export type GateUnlockRequest = z.infer<typeof GateUnlockSchema>;

/** One step of the student's "Before you start" checklist (neutral wording only). */
export interface StudentGateStep {
  gateId: string;
  step: 'questionnaire' | 'puzzles' | 'knowledge';
  occasion: string | null;
  label: string;
  done: boolean;
  next: boolean;
}
