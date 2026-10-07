import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
import { cohenKappa, confusion, indicators, segments } from './metrics';
import { ValidationService } from './validation.service';
import { ResearchExportsService } from '../exports/exports.service';
import {
  PromptClassifierService,
  parseLabel,
  CLASSIFIER_VERSION,
} from '../classifier/classifier.service';
import { redactText } from '../classifier/redact';
import { TransferTaskService } from '../transfer/transfer.service';
import { runRules } from '../engine/rules';
import { defaultParams } from '../engine/params';
import { prepareActions } from '../engine/prepare';
import type { RawAction } from '../engine/types';

const T0 = Date.UTC(2026, 9, 7, 9);

describe('validation metrics', () => {
  it('reproduces the workbook example row (TP 40, FP 25, FN 15, TN 120)', () => {
    expect(indicators({ tp: 40, fp: 25, fn: 15, tn: 120 })).toEqual({
      total: 200,
      matchRate: 0.8,
      sensitivity: 40 / 55,
      specificity: 120 / 145,
    });
  });

  it('counts segments with tolerance', () => {
    const segs = segments(0, 120_000, 30_000); // 4 segments
    const c = confusion(
      segs,
      [{ start: 10_000, end: 12_000 }],
      [{ start: 33_000, end: 33_000 }],
      5_000,
    );
    // trace in seg0; annotation at 33 s with ±5 s tolerance touches seg0 and seg1
    expect(c).toEqual({ tp: 1, fp: 0, fn: 1, tn: 2 });
  });

  it('Cohen κ', () => {
    expect(cohenKappa([1, 1, 0, 0], [1, 1, 0, 0])).toBe(1);
    expect(cohenKappa(['a', 'b', 'a', 'b'], ['a', 'a', 'b', 'b'])).toBe(0);
    expect(cohenKappa([1, 1], [1, 1])).toBe(1);
    expect(cohenKappa([], [])).toBeNull();
  });
});

describe('ValidationService.report', () => {
  const sessionId = 's1';
  const base = T0;
  const prisma = {
    replayAnnotation: {
      findMany: jest.fn().mockImplementation(({ distinct }) =>
        Promise.resolve(
          distinct
            ? [{ sessionId, researcherId: 'res-1' }]
            : [
                {
                  researcherId: 'res-1',
                  startMs: BigInt(5_000),
                  endMs: BigInt(20_000),
                  code: { label: 'Forethought/prediction' },
                },
                {
                  researcherId: 'res-1',
                  startMs: BigInt(95_000),
                  endMs: null,
                  code: { label: 'Re-reading' },
                },
              ],
        ),
      ),
    },
    session_sync_anchors: {
      findUnique: jest.fn().mockResolvedValue({ wallClockMs: BigInt(base) }),
    },
    sessionReplaySnapshot: { findFirst: jest.fn().mockResolvedValue(null) },
    studentSession: { findUnique: jest.fn().mockResolvedValue({ startedAt: new Date(base) }) },
    learningEvent: {
      findMany: jest.fn().mockResolvedValue([
        { ruleId: 'M05', startAt: new Date(base + 10_000), endAt: new Date(base + 10_000) },
        { ruleId: 'M03', startAt: new Date(base + 60_000), endAt: new Date(base + 70_000) },
      ]),
    },
    activityLog: {
      findFirst: jest
        .fn()
        .mockImplementation(({ orderBy }) =>
          Promise.resolve({
            occurredAt: new Date(base + (orderBy.occurredAt === 'desc' ? 120_000 : 0)),
          }),
        ),
    },
    replayCode: {
      findMany: jest.fn().mockResolvedValue([{ label: 'Orientation' }]),
      createMany: jest.fn(),
    },
  };
  const service = new ValidationService(prisma as any);

  it('aligns annotations (offsets from the replay anchor) with learning events per rule', async () => {
    const r = await service.report('course-1', { researcherId: 'res-1' });
    const m05 = r.rows.find((x) => x.mappingId === 'M05')!;
    expect(m05).toMatchObject({ tp: 1, fp: 0, fn: 0, tn: 3, total: 4, matchRate: 1 });
    const m03b = r.rows.find((x) => x.mappingId === 'M03b')!;
    expect(m03b).toMatchObject({ tp: 0, fn: 1 }); // coded re-reading, trace said first reading
    expect(r.rows.find((x) => x.mappingId === 'M10')!.notes).toMatch(/No think-aloud code/);
    expect(r.rows).toHaveLength(36);
  });

  it('writes the Validation sheet columns in order, with a pooled row', async () => {
    const csv = await service.reportCsv('course-1', { researcherId: 'res-1' });
    const [head, , ...rest] = csv.trim().split('\n');
    expect(head).toBe(
      'Mapping ID,Process,Both coded (TP),Trace only (FP),Think-aloud only (FN),Neither (TN),Total segments,Match rate,Sensitivity,Specificity,Notes',
    );
    expect(rest[rest.length - 1]).toMatch(/^Pooled \(excl\. example\),/);
  });

  it('seeds only the missing codebook labels for the researcher', async () => {
    const res = await service.seedCodes('res-1');
    expect(res.created).not.toContain('Orientation');
    expect(res.created).toContain('Think-aloud sync');
    expect(prisma.replayCode.createMany).toHaveBeenCalled();
  });
});

describe('ResearchExportsService', () => {
  const prev = process.env.RESEARCH_EXPORT_SALT;
  afterEach(() => {
    process.env.RESEARCH_EXPORT_SALT = prev;
  });

  it('refuses to export without a salt (never falls back to real ids)', () => {
    delete process.env.RESEARCH_EXPORT_SALT;
    const s = new ResearchExportsService({} as any);
    expect(() => s.pseudonym('student-1')).toThrow(ServiceUnavailableException);
  });

  it('pseudonyms are stable per salt and never contain the id', () => {
    process.env.RESEARCH_EXPORT_SALT = 'a-long-enough-test-salt';
    const s = new ResearchExportsService({} as any);
    const p = s.pseudonym('11111111-1111-1111-1111-111111111111');
    expect(p).toMatch(/^[0-9a-f]{16}$/);
    expect(s.pseudonym('11111111-1111-1111-1111-111111111111')).toBe(p);
    expect(s.pseudonym('11111111-1111-1111-1111-111111111111', 'another-salt-entirely')).not.toBe(
      p,
    );
  });

  it('event log (learning events) has bupaR-ready columns and pseudonymised cases', async () => {
    process.env.RESEARCH_EXPORT_SALT = 'a-long-enough-test-salt';
    const prisma = {
      studentSession: { findMany: jest.fn().mockResolvedValue([{ id: 'sess-aaaaaaaa' }]) },
      activityLog: { findMany: jest.fn().mockResolvedValue([]) },
      learningEvent: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'le1',
            studentId: 'student-1',
            sessionId: 'sess-aaaaaaaa',
            moduleItemId: 'item-bbbbbbbb',
            eventFamily: 'Forethought / prediction',
            ruleId: 'M05',
            outcome: 'think',
            slideKey: 's1-3',
            startAt: new Date(T0),
            endAt: new Date(T0 + 1000),
            libraryVersion: 'v2',
            parameterSetVersion: 1,
          },
        ]),
      },
    };
    const csv = await new ResearchExportsService(prisma as any).eventLogCsv(
      'course-1',
      'learning_event',
      'item',
    );
    const [head, row] = csv.trim().split('\n');
    expect(head).toBe(
      'case_id,activity,activity_instance,timestamp_start,timestamp_end,resource,rule_id,outcome,slide_key,library_version,parameter_set_version',
    );
    expect(row).not.toContain('student-1');
    expect(row).toMatch(
      /^[0-9a-f]{16}_item-bbb,Forethought \/ prediction,le1,2026-10-07T09:00:00.000Z/,
    );
  });
});

describe('prompt classifier', () => {
  it('parses only codebook labels from JSON replies', () => {
    expect(parseLabel('{"label":"executive"}')).toBe('executive');
    expect(parseLabel('Sure! {"label": "Conceptual"}')).toBe('conceptual');
    expect(parseLabel('{"label":"helpful"}')).toBeNull();
    expect(parseLabel('not json')).toBeNull();
  });

  it('redacts emails, phones and ids in coding samples', () => {
    expect(redactText('mail me at a.b@x.com or +65 9123 4567, NRIC S1234567D')).toBe(
      'mail me at [EMAIL] or [PHONE], NRIC [NRIC]',
    );
  });

  function agreementPrisma(human: Array<{ coderId: string; sourceId: string; label: string }>) {
    const llm = ['p1', 'p2', 'p3', 'p4'].map((id, i) => ({
      sourceType: 'prompt_lab_run',
      sourceId: id,
      label: ['executive', 'conceptual', 'executive', 'task_prompt'][i],
    }));
    return {
      aiPromptClassification: { findMany: jest.fn().mockResolvedValue(llm) },
      aiPromptHumanLabel: {
        findMany: jest
          .fn()
          .mockResolvedValue(human.map((h) => ({ ...h, sourceType: 'prompt_lab_run' }))),
      },
    };
  }

  it('is not eligible for validation without two human coders', async () => {
    const svc = new PromptClassifierService(
      agreementPrisma([{ coderId: 'c1', sourceId: 'p1', label: 'executive' }]) as any,
      {} as any,
    );
    const a = await svc.agreement('course-1');
    expect(a.eligibleForValidation).toBe(false);
    expect(a.reason).toMatch(/two human coders/);
    expect(a.classifierVersion).toBe(CLASSIFIER_VERSION);
  });

  it('becomes eligible when human–human and human–LLM κ clear the thresholds', async () => {
    const labels = ['executive', 'conceptual', 'executive', 'task_prompt'];
    const human = ['c1', 'c2'].flatMap((c) =>
      labels.map((label, i) => ({ coderId: c, sourceId: `p${i + 1}`, label })),
    );
    const a = await new PromptClassifierService(agreementPrisma(human) as any, {} as any).agreement(
      'course-1',
    );
    expect(a.humanHuman[0]!.kappa).toBe(1);
    expect(a.eligibleForValidation).toBe(true);
  });
});

describe('TransferTaskService.score', () => {
  const prisma = {
    moduleItem: {
      findMany: jest.fn().mockResolvedValue([
        {
          id: 'item-1',
          title: 'S1',
          lessonJson: {
            slides: [{ key: 's1-26', t: 'transfer', criteria: ['Gives context', 'States format'] }],
          },
        },
      ]),
    },
    transferTaskScore: {
      upsert: jest.fn().mockImplementation(({ create }) => Promise.resolve(create)),
    },
  };
  const svc = new TransferTaskService(prisma as any);
  const body = { studentId: 'stu-1', moduleItemId: 'item-1', slideKey: 's1-26' };

  it('scores 0–2 per rubric criterion', async () => {
    const r = await svc.score('course-1', 'teacher-1', { ...body, scores: [2, 1] });
    expect(r).toMatchObject({ total: 3, maxTotal: 4, scorerId: 'teacher-1' });
  });

  it('rejects the wrong number of scores or out-of-range values', async () => {
    await expect(svc.score('course-1', 't', { ...body, scores: [2] })).rejects.toThrow(
      BadRequestException,
    );
    await expect(svc.score('course-1', 't', { ...body, scores: [3, 0] })).rejects.toThrow(
      BadRequestException,
    );
  });
});

describe('engine: classifier-backed rules and transfer', () => {
  const act = (action: string, sec: number, meta: Record<string, unknown> = {}): RawAction => ({
    id: `${action}-${sec}`,
    action,
    at: T0 + sec * 1000,
    courseId: 'c',
    moduleItemId: 'i',
    interventionId: null,
    meta,
  });
  const input = (
    actions: RawAction[],
    classifications = [] as Array<{
      sourceType: string;
      sourceId: string;
      at: number;
      label: string;
    }>,
  ) => ({
    actions: prepareActions(actions).actions,
    visibility: [],
    prior: { visits: new Map(), commits: new Set<string>() },
    params: defaultParams(),
    classifications,
  });

  it('M08 takes its help type from a classification within 10 s; M33 emits one event per label', () => {
    const d = runRules(
      input(
        [act('CHATBOT_MESSAGE_SENT', 0), act('CHATBOT_MESSAGE_SENT', 100)],
        [{ sourceType: 'chatbot_message', sourceId: 'm1', at: T0 + 2_000, label: 'executive' }],
      ),
    );
    expect(d.filter((x) => x.ruleId === 'M08').map((x) => x.outcome)).toEqual([
      'executive',
      'untyped',
    ]);
    expect(d.filter((x) => x.ruleId === 'M33').map((x) => x.outcome)).toEqual(['executive']);
  });

  it('M35 records transfer submissions', () => {
    const d = runRules(
      input([act('TRANSFER_TASK_SUBMITTED', 5, { slideKey: 's1-26', chars: 300 })]),
    );
    expect(d.filter((x) => x.ruleId === 'M35')).toEqual([
      expect.objectContaining({ outcome: 'transfer_submitted' }),
    ]);
  });
});
