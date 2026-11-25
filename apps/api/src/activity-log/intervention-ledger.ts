import type { PrismaService } from '../prisma/prisma.service';

/**
 * The intervention ledger (Prompt B, P5 / WP5 G5; CAP-01, CAP-23): one row
 * per learner-launched strategy and per system decision about a suggestion,
 * including evaluations that showed nothing (NO_ACTION). Every
 * INTERVENTION_TRIGGERED row also carries `metadata.initiator`, so the
 * legacy action can never be misread as a system intervention.
 */
export type Initiator = 'learner' | 'system';
export type LedgerDecision = 'launched' | 'shown' | 'withheld' | 'no_action';

export interface LedgerRow {
  sessionId?: string | null;
  userId: string;
  courseId?: string | null;
  moduleItemId?: string | null;
  initiator: Initiator;
  decision: LedgerDecision;
  reason?: string | null;
  interventionType?: string | null;
  interventionId?: string | null;
  ruleId?: string | null;
  policyId?: string | null;
  arm?: string | null;
}

/** Who started an intervention, from its metadata (nudges carry rule_triggered or an arm). */
export function initiatorFromMeta(meta: Record<string, unknown> | null | undefined): Initiator {
  if (meta?.initiator === 'learner' || meta?.initiator === 'system') return meta.initiator;
  return meta?.triggerReason === 'rule_triggered' || meta?.arm != null ? 'system' : 'learner';
}

/** The ledger row for an INTERVENTION_TRIGGERED activity row. */
export function ledgerFromTrigger(e: {
  sessionId?: string | null;
  userId: string;
  courseId?: string | null;
  moduleItemId?: string | null;
  interventionId?: string | null;
  metadata?: Record<string, unknown> | null;
}): LedgerRow {
  const m = e.metadata ?? {};
  const initiator = initiatorFromMeta(m);
  const str = (v: unknown) => (typeof v === 'string' ? v : null);
  return {
    sessionId: e.sessionId ?? null,
    userId: e.userId,
    courseId: e.courseId ?? null,
    moduleItemId: e.moduleItemId ?? null,
    initiator,
    decision: initiator === 'learner' ? 'launched' : m.shown === false ? 'withheld' : 'shown',
    reason: str(m.triggerReason),
    interventionType: str(m.interventionType),
    interventionId: e.interventionId ?? null,
    ruleId: str(m.ruleId),
    policyId: str(m.policyId),
    arm: str(m.arm),
  };
}

/** Write ledger rows; never throws (the ledger must not break the flow it records). */
export async function writeLedger(prisma: PrismaService, rows: LedgerRow[]): Promise<void> {
  if (!rows.length) return;
  try {
    await prisma.interventionLedger.createMany({ data: rows });
  } catch {
    // Logged by the caller's own error handling where it matters; never fatal.
  }
}
