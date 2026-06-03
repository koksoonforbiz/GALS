import { describe, it, expect } from 'vitest';
import { resolveAoi, computePdt, allocationScore, segmentEpochs } from './attention.js';

describe('resolveAoi', () => {
  it('prefers the smaller rectangle when nested', () => {
    const big = { region: 'lesson', x: 0, y: 0, width: 1000, height: 1000 };
    const small = { region: 'chatbot', x: 100, y: 100, width: 200, height: 200 };
    expect(resolveAoi(150, 150, [big, small])).toBe('chatbot');
    expect(resolveAoi(500, 500, [big, small])).toBe('lesson');
    expect(resolveAoi(5000, 5000, [big, small])).toBeNull();
  });
});

describe('computePdt', () => {
  it('attributes gaze dwell to regions and sums to ~1', () => {
    const aois = [
      { region: 'lesson', x: 0, y: 0, width: 800, height: 600 },
      { region: 'chatbot', x: 800, y: 0, width: 200, height: 600 },
    ];
    const snapshots = [{ wallMs: 0, aois }];
    const gaze = [
      { wallMs: 0, x: 100, y: 100 },   // lesson, dwell 100ms
      { wallMs: 100, x: 100, y: 100 }, // lesson, dwell 100ms
      { wallMs: 200, x: 900, y: 100 }, // chatbot, dwell 100ms
      { wallMs: 300, x: 900, y: 100 }, // last point: 0 weight
    ];
    const r = computePdt(gaze, snapshots);
    const total = Object.values(r.pdt).reduce((a, b) => a + b, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(r.pdt.lesson).toBeCloseTo(2 / 3, 2);
    expect(r.pdt.chatbot).toBeCloseTo(1 / 3, 2);
  });
});

describe('allocationScore', () => {
  it('is 0 when observed == expected', () => {
    expect(allocationScore({ lesson: 0.7, chatbot: 0.3 }, { lesson: 0.7, chatbot: 0.3 })).toBeCloseTo(0, 6);
  });
  it('is 1 when fully disjoint', () => {
    expect(allocationScore({ lesson: 1 }, { chatbot: 1 })).toBeCloseTo(1, 6);
  });
  it('is between 0 and 1 for partial overlap', () => {
    const s = allocationScore({ lesson: 0.5, chatbot: 0.5 }, { lesson: 0.7, chatbot: 0.3 });
    expect(s).toBeGreaterThan(0);
    expect(s).toBeLessThan(1);
  });
});

describe('segmentEpochs', () => {
  it('produces an epoch spanning bounds when no activity', () => {
    const e = segmentEpochs([], { startWallMs: 0, endWallMs: 1000 });
    expect(e).toHaveLength(1);
    expect(e[0].type).toBe('reading_lesson');
  });
  it('classifies intervention and chatbot activity', () => {
    const e = segmentEpochs(
      [
        { wallMs: 0, action: 'PAGE_VIEW' },
        { wallMs: 1000, action: 'INTERVENTION_STARTED' },
        { wallMs: 2000, action: 'CHATBOT_MESSAGE_SENT' },
      ],
      { startWallMs: 0, endWallMs: 3000 },
      { idleGapMs: 10_000 },
    );
    const types = e.map((x) => x.type);
    expect(types).toContain('intervention_active');
    expect(types).toContain('chatbot_dialogue');
  });
});
