/**
 * Phase 6 over HTTP: scores written on run completion, blind two-rater
 * coding of W4/W5 with agreement → final codes, the disagreement queue and
 * adjudication, κ, re-scoring and the five pseudonymised exports.
 */
import * as path from 'path';
import request from 'supertest';
import { INestApplication } from '@nestjs/common';
import type {
  EfaCodingItem,
  PuzzleQuestionItem,
  PuzzleQuestionSection,
  PuzzleStepView,
} from '@ats/shared';
import { PrismaService } from '../prisma';
import { createTestApp, cleanDatabase } from '../test/setup';
import { loadBatteryFiles } from './battery/battery-files';
import { seedBattery } from './battery/seed-battery';
import { EFA_NOTICE_VERSION } from './consent-notice';
import { SCORING_VERSION } from './scoring/scoring';

process.env.RESEARCH_EXPORT_SALT ??= 'phase6-efa-integration-salt';

const PASSWORD = 'Test-Passw0rd!';
const device = {
  userAgent: 'jest',
  screenW: 1920,
  screenH: 1080,
  viewportW: 1600,
  viewportH: 900,
  devicePixelRatio: 1,
  pointerFine: true,
  hoverNone: false,
  keyboardConfirmed: true,
  fullscreenAccepted: true,
};
const answerFor = (i: PuzzleQuestionItem): unknown =>
  i.type === 'number'
    ? (i.min ?? 1)
    : i.type === 'scale'
      ? i.max
      : i.type === 'text'
        ? 'English'
        : i.type === 'text2'
          ? { first: 'E', second: 'E' }
          : { option: i.options![0] };

function resultFor(step: PuzzleStepView) {
  const t = { onsetMs: 10, firstInputMs: 400, submitMs: 900, focusLostMs: 0 };
  const p = step.payload as Record<string, unknown>;
  switch (step.kind) {
    case 'sequence':
      return {
        kind: 'sequence',
        response: (p.direction === 'bwd'
          ? [...(p.items as string[])].reverse()
          : (p.items as string[])
        ).join(''),
        shownMs: (p.items as string[]).map(() => 800),
        ...t,
      };
    case 'item':
      return { kind: 'item', response: '1', ...t };
    case 'list':
      return {
        kind: 'list',
        responses: (p.numbers as number[]).map((n, i) => ({
          response: String(n + 3),
          onsetMs: i * 1000,
          submitMs: i * 1000 + 800,
        })),
        startMs: 0,
        endMs: 30_000,
      };
    case 'sentence':
      return { kind: 'sentence', response: 'piano', ...t };
    case 'prompt':
      return {
        kind: 'prompt',
        entries: [
          { text: 'fish', atMs: 1200 },
          { text: 'fish', atMs: 2400 },
          { text: 'fern', atMs: 3600 },
        ],
        startMs: 0,
        endMs: 60_000,
      };
    case 'grid':
      return {
        kind: 'grid',
        presses: [{ i: 0, key: 'red', atMs: 300 }],
        startMs: 0,
        endMs: 45_000,
      };
    case 'trail':
      return {
        kind: 'trail',
        clicks: [{ label: '1', atMs: 500 }],
        startMs: 0,
        endMs: 9_000,
        pxPerMm: 3,
      };
  }
}

describe('EF scoring, coding and exports (HTTP)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let studentToken: string;
  let ownerToken: string;
  let raterToken: string;
  let outsiderToken: string;
  let studentId: string;
  let raterId: string;
  let courseId: string;
  let sessionId: string;
  let occasionId: string;

  const http = () => request(app.getHttpServer());
  const asStudent = (r: request.Test) =>
    r.set('Authorization', `Bearer ${studentToken}`).set('x-session-id', sessionId);
  const as = (token: string, r: request.Test) => r.set('Authorization', `Bearer ${token}`);
  const admin = (p: string) => `/api/efa-admin/courses/${courseId}${p}`;
  const runScores = async (task: string) => {
    const run = await prisma.efaTaskRun.findFirstOrThrow({
      where: { occasionId, taskCode: task },
      include: { scores: true },
    });
    return run.scores.find((s) => s.scoringVersion === SCORING_VERSION)!;
  };
  /** Code every queued item: `pick(item, entry)` → code (+category). */
  async function codeAll(
    token: string,
    task: string,
    pick: (it: EfaCodingItem, i: number) => { code: string; category?: string },
  ) {
    // the queue is served a page (10) at a time
    for (;;) {
      const q = await as(token, http().get(admin(`/coding/${task}/queue`))).expect(200);
      if (!q.body.items.length) return;
      for (const it of q.body.items as EfaCodingItem[]) {
        await as(token, http().post(admin(`/coding/items/${it.itemId}`)))
          .send({
            codes: it.entries.map((e) => ({ entryIndex: e.entryIndex, ...pick(it, e.entryIndex) })),
          })
          .expect(201);
      }
    }
  }
  const w4pick = (it: EfaCodingItem, i: number) =>
    i === 1
      ? { code: 'repeat' }
      : { code: 'valid', ...(it.categories ? { category: it.categories[i === 0 ? 0 : 1] } : {}) };

  beforeAll(async () => {
    ({ app, prisma } = await createTestApp());
    await cleanDatabase(prisma);
    await prisma.efaAllocationSlot.deleteMany();
    await prisma.efaStimulusSet.deleteMany();
    await seedBattery(
      prisma as never,
      loadBatteryFiles(path.resolve(__dirname, '../../../../docs/EF_battery_v2')),
    );
    const reg = async (email: string, role: string) =>
      (
        await http()
          .post('/api/auth/register')
          .send({ email, password: PASSWORD, termsAccepted: true, name: email, role })
      ).body;
    const owner = await reg('p6-owner@test.com', 'teacher');
    const rater = await reg('p6-rater@test.com', 'teacher');
    const outsider = await reg('p6-outsider@test.com', 'teacher');
    const student = await reg('p6-student@test.com', 'student');
    [ownerToken, raterToken, outsiderToken, studentToken] = [owner, rater, outsider, student].map(
      (u) => u.accessToken,
    );
    studentId = student.user.id;
    raterId = rater.user.id;
    courseId = (
      await prisma.course.create({
        data: {
          title: 'P6 course',
          description: 'x',
          teacherId: owner.user.id,
          status: 'PUBLISHED',
        },
      })
    ).id;
    const m1 = (
      await prisma.courseModule.create({ data: { courseId, title: 'Session 1', orderIndex: 0 } })
    ).id;
    for (const [kind, sequence] of [
      ['EF_QUESTIONNAIRE', 10],
      ['EF_TESTS', 20],
    ] as const) {
      await prisma.courseGate.create({
        data: { courseId, kind, occasion: 'T0', position: 'BEFORE_MODULE', moduleId: m1, sequence },
      });
    }
    await prisma.enrollment.create({ data: { studentId, courseId, status: 'ACTIVE' } });
    // Two raters for W4 (owner + an assistant who does not own the course).
    await prisma.efaRaterAssignment.createMany({
      data: [owner.user.id, raterId].map((id) => ({ courseId, taskCode: 'w4', raterId: id })),
    });
    sessionId = (
      await http()
        .post('/api/activity-log/session/open')
        .set('Authorization', `Bearer ${studentToken}`)
    ).body.sessionId;
    await asStudent(http().patch('/api/activity-log/session/course'))
      .send({ courseId })
      .expect(200);

    occasionId = (
      await asStudent(http().post(`/api/puzzles/courses/${courseId}/occasions/T0/start`)).send({
        noticeVersion: EFA_NOTICE_VERSION,
        accepted: true,
        device,
      })
    ).body.occasionId;
    const answerAll = async (part: string) => {
      const q = await asStudent(
        http().get(`/api/puzzles/occasions/${occasionId}/questionnaire?part=${part}`),
      );
      for (const item of (q.body.sections as PuzzleQuestionSection[]).flatMap((s) => s.items)) {
        await asStudent(
          http().put(`/api/puzzles/occasions/${occasionId}/answers/${item.code}`),
        ).send({ value: answerFor(item) });
      }
      await asStudent(http().post(`/api/puzzles/occasions/${occasionId}/questionnaire/submit`))
        .send({ part })
        .expect(201);
    };
    await answerAll('before');
    await asStudent(http().post(`/api/puzzles/occasions/${occasionId}/colour-check`))
      .send({ answers: (['red', 'green', 'blue'] as const).map((c) => ({ shown: c, chosen: c })) })
      .expect(201);
    for (const task of ['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']) {
      const b = await asStudent(
        http().post(`/api/puzzles/occasions/${occasionId}/tasks/${task}/begin`),
      ).expect(201);
      let step: PuzzleStepView | null = b.body.step;
      while (step) {
        const r = await asStudent(http().post(`/api/puzzles/runs/${b.body.runId}/steps`))
          .send({ stepId: step.id, attempt: step.attempt, result: resultFor(step) })
          .expect(201);
        step = r.body.next;
      }
    }
    await answerAll('after');
  }, 180_000);

  afterAll(async () => {
    await prisma.efaRaterAssignment.deleteMany({ where: { courseId } });
    await prisma.courseGate.deleteMany({ where: { courseId } });
    await prisma.efaOccasion.deleteMany({ where: { courseId } });
    await prisma.efaAllocationSlot.deleteMany();
    await prisma.efaStimulusSet.deleteMany();
    await cleanDatabase(prisma);
    await app.close();
  });

  it('every finished run is scored on completion (current scoring version)', async () => {
    const w1 = await runScores('w1');
    expect(w1.scores).toEqual(expect.objectContaining({ fwd_total: 16, bwd_total: 14 }));
    // the fake answers are n+3 everywhere: right on the plus list only, half right when alternating
    expect((await runScores('w3')).scores).toEqual(
      expect.objectContaining({ e1: 0, e2: 30, e3: 15, t1_s: 29.8, switch_cost_s: 0 }),
    );
    expect((await runScores('w6')).scores).toHaveProperty('golden_ig');
    expect((await runScores('w4')).flags).toEqual(
      expect.objectContaining({ awaiting_coding: true }),
    );
    expect((await runScores('w5')).flags).toEqual(
      expect.objectContaining({ awaiting_coding: true, w5_unnormed: true }),
    );
    const o = await prisma.efaOccasion.findUniqueOrThrow({ where: { id: occasionId } });
    expect(o.scoringVersion).toBe(SCORING_VERSION);
  });

  it('staff routes are closed to students, other teachers, and raters for owner-only actions', async () => {
    await as(studentToken, http().get(admin('/coding/summary'))).expect(403);
    await as(outsiderToken, http().get(admin('/coding/summary'))).expect(403);
    await as(raterToken, http().get(admin('/coding/summary'))).expect(200);
    await as(raterToken, http().get(admin('/coding/w4/disagreements'))).expect(403);
    await as(raterToken, http().get(admin('/export/trials.csv'))).expect(403);
    await as(raterToken, http().post(admin('/rescore'))).expect(403);
    // W5 is not assigned → open to course staff only; the assistant is not.
    await as(raterToken, http().get(admin('/coding/w5/queue'))).expect(403);
  });

  it('the rater queue is blind: no student, occasion or run identifiers', async () => {
    const q = await as(raterToken, http().get(admin('/coding/w4/queue'))).expect(200);
    expect(q.body.remaining).toBe(5);
    const text = JSON.stringify(q.body);
    for (const id of [studentId, occasionId, 'T0', 'p6-student']) expect(text).not.toContain(id);
    const first = (q.body.items as EfaCodingItem[]).find((i) => i.prompt.kind !== 'switch')!;
    expect(first.entries.map((e) => e.text)).toEqual(['fish', 'fish', 'fern']);
    expect(first.entries[1]!.hints).toContain('repeat');
  });

  it('two agreeing raters make final codes; one disagreement waits for adjudication; then W4 is scored', async () => {
    await codeAll(ownerToken, 'w4', w4pick);
    // the assistant disagrees on entry 2 of the letter lists only
    await codeAll(raterToken, 'w4', (it, i) =>
      i === 2 && it.prompt.kind === 'letter' ? { code: 'rule_break' } : w4pick(it, i),
    );
    // nothing is left for this rater
    await as(raterToken, http().get(admin('/coding/w4/queue')))
      .expect(200)
      .expect((r) => expect(r.body.remaining).toBe(0));

    const summary = (await as(ownerToken, http().get(admin('/coding/summary'))).expect(200)).body;
    const w4 = summary.find((s: { task: string }) => s.task === 'w4');
    expect(w4).toEqual(
      expect.objectContaining({
        items: 5,
        entries: 15,
        doubleCoded: 15,
        disagreements: 3,
        finalised: 12,
      }),
    );
    expect(w4.kappa).toBeGreaterThan(0);
    expect(w4.kappa).toBeLessThan(1);
    expect((await runScores('w4')).flags).toEqual(
      expect.objectContaining({ awaiting_coding: true }),
    );

    const d = await as(ownerToken, http().get(admin('/coding/w4/disagreements'))).expect(200);
    expect(d.body.items).toHaveLength(3);
    for (const it of d.body.items as EfaCodingItem[]) {
      const e = it.entries.find((x) => x.entryIndex === 2)!;
      expect(e.raters).toEqual([
        { code: 'valid', category: null },
        { code: 'rule_break', category: null },
      ]);
      await as(ownerToken, http().post(admin(`/coding/items/${it.itemId}/final`)))
        .send({ codes: [{ entryIndex: 2, code: 'valid' }] })
        .expect(201);
    }
    const s = await runScores('w4');
    expect(s.flags).not.toHaveProperty('awaiting_coding');
    expect(s.scores).toEqual(
      expect.objectContaining({
        letter1_valid: 2,
        letter1_repeats: 1,
        switch_valid: 2,
        switch_correct_switches: 0,
      }),
    );
    const finals = await prisma.efaFinalCode.groupBy({ by: ['source'], _count: true });
    expect(Object.fromEntries(finals.map((f) => [f.source, f._count]))).toEqual({
      rater_agree: 12,
      adjudicated: 3,
    });
  });

  it('W5: anchors and expected word shown; validation by task; B error score once both raters agree', async () => {
    // make the assistant a W5 rater too
    await prisma.efaRaterAssignment.createMany({
      data: [
        { courseId, taskCode: 'w5', raterId },
        {
          courseId,
          taskCode: 'w5',
          raterId: (await prisma.course.findUniqueOrThrow({ where: { id: courseId } })).teacherId,
        },
      ],
    });
    const q = await as(ownerToken, http().get(admin('/coding/w5/queue'))).expect(200);
    expect(q.body.remaining).toBe(15);
    const it: EfaCodingItem = q.body.items[0];
    expect(it.expected).toBeTruthy();
    expect(it.anchors).toEqual(
      expect.objectContaining({ a: expect.any(String), b: expect.any(String) }),
    );
    expect(it.entries[0]).toEqual(expect.objectContaining({ text: 'piano', suggested: null }));
    await as(ownerToken, http().post(admin(`/coding/items/${it.itemId}`)))
      .send({ codes: [{ entryIndex: 0, code: 'valid' }] })
      .expect(400);

    for (const t of [ownerToken, raterToken]) await codeAll(t, 'w5', () => ({ code: '0' }));
    const s = await runScores('w5');
    expect(s.scores).toEqual(
      expect.objectContaining({ b_error_score: 0, b_a_codes: 0, b_b_codes: 0 }),
    );
    expect(s.flags).not.toHaveProperty('awaiting_coding');
  });

  it('re-score recomputes every finished run and keeps the same version row', async () => {
    const before = await prisma.efaTaskScore.count();
    const r = await as(ownerToken, http().post(admin('/rescore'))).expect(201);
    expect(r.body).toEqual({ scoringVersion: SCORING_VERSION, runs: 7, scored: 7 });
    expect(await prisma.efaTaskScore.count()).toBe(before);
  });

  it('the five exports are pseudonymised and carry the expected content', async () => {
    const get = async (f: string) =>
      (await as(ownerToken, http().get(admin(`/export/${f}`))).expect(200)).text;
    const files = {
      trials: await get('trials.csv'),
      scores: await get('task-scores.csv'),
      questionnaire: await get('questionnaire.csv'),
      occasions: await get('occasions.csv'),
      coding: await get('coding.csv'),
    };
    for (const body of Object.values(files)) {
      expect(body.startsWith('pid,')).toBe(true);
      expect(body).not.toContain(studentId);
      expect(body).not.toContain(raterId);
      expect(body).not.toContain('p6-student');
    }
    expect(files.occasions).toContain(SCORING_VERSION);
    expect(files.scores).toMatch(/,w6,1,completed,efa-1.1.0,golden_ig,/);
    expect(files.questionnaire).toMatch(/,score,adexi_wm,45,/);
    expect(files.questionnaire).toMatch(/,score,adexi_inh,25,/);
    expect(files.trials.split('\n').filter((l) => l.includes(',w1,')).length).toBeGreaterThan(30);
    expect(files.coding.split('\n').filter((l) => l.includes(',w4,')).length).toBe(15);
    await as(ownerToken, http().get(admin('/export/secrets.csv'))).expect(404);
  });
});
