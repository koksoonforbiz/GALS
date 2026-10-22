import { computeLockState, type LockGate } from './lock-state';

const modules = [1, 2, 3, 4].map((n) => ({ id: `m${n}`, orderIndex: n - 1 }));
const gate = (
  id: string,
  moduleId: string,
  position: LockGate['position'],
  sequence: number,
  required = true,
) => ({
  id,
  moduleId,
  position,
  sequence,
  required,
});

// T0 questionnaire + tests before m1, T1 before m3, T2 after m4.
const gates = [
  gate('t0q', 'm1', 'BEFORE_MODULE', 10),
  gate('t0t', 'm1', 'BEFORE_MODULE', 20),
  gate('t1', 'm3', 'BEFORE_MODULE', 110),
  gate('t2', 'm4', 'AFTER_MODULE', 910),
];

const locked = (done: string[]) =>
  [...computeLockState(modules, gates, new Set(done)).lockedModuleIds].sort();

describe('computeLockState', () => {
  it('no gates → nothing locked', () => {
    expect(computeLockState(modules, [], new Set()).lockedModuleIds.size).toBe(0);
  });

  it('T0 incomplete locks the whole course', () => {
    expect(locked([])).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(locked(['t0q'])).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('T0 done opens up to the T1 gate', () => {
    expect(locked(['t0q', 't0t'])).toEqual(['m3', 'm4']);
  });

  it('a later gate cannot be skipped by completing it out of order', () => {
    expect(locked(['t1'])).toEqual(['m1', 'm2', 'm3', 'm4']);
  });

  it('an AFTER gate on the last module locks no module', () => {
    expect(locked(['t0q', 't0t', 't1'])).toEqual([]);
  });

  it('optional gates never lock', () => {
    const opt = [gate('t1', 'm3', 'BEFORE_MODULE', 110, false)];
    expect(computeLockState(modules, opt, new Set()).lockedModuleIds.size).toBe(0);
  });

  it('steps are in course order, with the first incomplete required gate as next', () => {
    const { steps } = computeLockState(modules, [...gates].reverse(), new Set(['t0q']));
    expect(steps.map((s) => s.gate.id)).toEqual(['t0q', 't0t', 't1', 't2']);
    expect(steps.filter((s) => s.next).map((s) => s.gate.id)).toEqual(['t0t']);
    expect(steps.map((s) => s.done)).toEqual([true, false, false, false]);
  });
});
