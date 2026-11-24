import { computeCourseProgress, type ProgressGate } from './progress';

const modules = [
  { id: 'm0', title: 'Before you start', orderIndex: 0 },
  { id: 'm1', title: 'Session 1: Foundations', orderIndex: 1 },
  { id: 'm2', title: 'Session 2: Structure', orderIndex: 2 },
];

function gate(
  id: string,
  moduleId: string,
  position: ProgressGate['position'],
  sequence: number,
  done: boolean,
  occasion: string | null = null,
): ProgressGate {
  return {
    id,
    moduleId,
    position,
    sequence,
    step: occasion ? 'knowledge' : 'questionnaire',
    label: id,
    occasion,
    done,
  };
}

describe('computeCourseProgress', () => {
  const gates = [
    gate('warmup', 'm1', 'BEFORE_MODULE', 0, true),
    gate('s1pre', 'm1', 'BEFORE_MODULE', 1, true, 'S1_PRE'),
    gate('s1post', 'm1', 'AFTER_MODULE', 0, false, 'S1_POST'),
    gate('s2pre', 'm2', 'BEFORE_MODULE', 0, false, 'S2_PRE'),
  ];
  const lessons = [
    { sessionNo: 1, moduleId: 'm1', lessonItemId: 'l1', started: true, finished: true },
    { sessionNo: 2, moduleId: 'm2', lessonItemId: 'l2', started: false, finished: false },
  ];

  it('orders steps: before-gates, lesson, after-gates, module by module', () => {
    const r = computeCourseProgress(modules, gates, lessons, new Set(['m2']));
    expect(r.steps.map((s) => s.label)).toEqual([
      'warmup',
      's1pre',
      'Session 1 lesson',
      's1post',
      's2pre',
      'Session 2 lesson',
    ]);
    expect(r.done).toBe(3);
    expect(r.total).toBe(6);
    expect(r.next).toMatchObject({ label: 's1post', sessionNo: 1, step: 'knowledge' });
  });

  it('session states follow the lock and the lesson', () => {
    const r = computeCourseProgress(modules, gates, lessons, new Set(['m2']));
    expect(r.sessions).toEqual([
      { sessionNo: 1, title: 'Session 1: Foundations', state: 'done' },
      { sessionNo: 2, title: 'Session 2: Structure', state: 'locked' },
    ]);
    const open = computeCourseProgress(modules, gates, lessons, new Set());
    expect(open.sessions[1]!.state).toBe('open');
  });

  it('a course without gates or session lessons has nothing to track', () => {
    const r = computeCourseProgress(modules, [], [], new Set());
    expect(r).toMatchObject({ done: 0, total: 0, next: null, steps: [], sessions: [] });
  });
});
