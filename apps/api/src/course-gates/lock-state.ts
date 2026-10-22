/**
 * Pure lock computation for course gates (no I/O, unit-tested).
 *
 * Walk the modules in orderIndex order. Before a module, its BEFORE_MODULE
 * gates apply; after it, its AFTER_MODULE gates apply. The first required
 * gate a student has not completed locks every module from that point on —
 * gates are a strict sequence, so a later gate can't be skipped by having
 * completed an earlier one out of order.
 */
export type GatePosition = 'BEFORE_MODULE' | 'AFTER_MODULE';

export interface LockModule {
  id: string;
  orderIndex: number;
}

export interface LockGate {
  id: string;
  moduleId: string;
  position: GatePosition;
  sequence: number;
  required: boolean;
}

export interface GateStep<G extends LockGate = LockGate> {
  gate: G;
  done: boolean;
  /** first incomplete required gate in course order */
  next: boolean;
}

export interface LockState<G extends LockGate = LockGate> {
  lockedModuleIds: Set<string>;
  /** all gates in course order with completion status */
  steps: GateStep<G>[];
}

export function computeLockState<G extends LockGate>(
  modules: LockModule[],
  gates: G[],
  completedGateIds: ReadonlySet<string>,
): LockState<G> {
  const ordered = [...modules].sort((a, b) => a.orderIndex - b.orderIndex);
  const byModule = new Map<string, G[]>();
  for (const g of gates) byModule.set(g.moduleId, [...(byModule.get(g.moduleId) ?? []), g]);
  const bySeq = (a: G, b: G) => a.sequence - b.sequence;

  const steps: GateStep<G>[] = [];
  const lockedModuleIds = new Set<string>();
  let locked = false;
  let nextAssigned = false;

  const visit = (g: G) => {
    const done = completedGateIds.has(g.id);
    const next = !done && g.required && !nextAssigned;
    if (next) nextAssigned = true;
    steps.push({ gate: g, done, next });
    if (!done && g.required) locked = true;
  };

  for (const m of ordered) {
    const own = byModule.get(m.id) ?? [];
    own
      .filter((g) => g.position === 'BEFORE_MODULE')
      .sort(bySeq)
      .forEach(visit);
    if (locked) lockedModuleIds.add(m.id);
    own
      .filter((g) => g.position === 'AFTER_MODULE')
      .sort(bySeq)
      .forEach(visit);
  }
  // Gates whose module no longer exists still show (and still block nothing).
  const known = new Set(ordered.map((m) => m.id));
  gates
    .filter((g) => !known.has(g.moduleId))
    .sort(bySeq)
    .forEach((g) => {
      steps.push({ gate: g, done: completedGateIds.has(g.id), next: false });
    });

  return { lockedModuleIds, steps };
}
