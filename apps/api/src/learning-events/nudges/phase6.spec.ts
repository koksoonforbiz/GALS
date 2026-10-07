import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { TextConsentService } from '../../governance/text-consent.service';
import { NudgeService } from './nudge.service';

jest.mock('../engine/prepare', () => ({
  prepareActions: (rows: Array<{ at: number }>) => ({ actions: rows }),
}));
const runRules = jest.fn();
jest.mock('../engine/rules', () => ({ runRules: (...a: unknown[]) => runRules(...a) }));

const NOW = Date.now();

interface ConsentRow {
  studentId: string;
  courseId: string;
  answerText?: boolean;
  promptsAndOutputs?: boolean;
  researchUse?: boolean;
  decidedAt: Date;
}

function consentPrisma(rows: ConsentRow[]) {
  const full = rows.map((r) => ({
    answerText: false,
    promptsAndOutputs: false,
    researchUse: false,
    noticeVersion: 'v1',
    ...r,
  }));
  return {
    textCaptureConsent: {
      findFirst: jest.fn(({ where }) =>
        Promise.resolve(
          full
            .filter((r) => r.studentId === where.studentId && r.courseId === where.courseId)
            .sort((a, b) => b.decidedAt.getTime() - a.decidedAt.getTime())[0] ?? null,
        ),
      ),
      findMany: jest.fn(({ where }) =>
        Promise.resolve(
          full
            .filter((r) => r.courseId === where.courseId)
            .sort((a, b) => a.decidedAt.getTime() - b.decidedAt.getTime()),
        ),
      ),
      create: jest.fn(),
    },
    enrollment: { findUnique: jest.fn() },
    studentSession: { findUnique: jest.fn().mockResolvedValue({ userId: 'stu' }) },
    promptLabRun: { updateMany: jest.fn().mockResolvedValue({ count: 2 }) },
    promptLabVersion: {
      findMany: jest
        .fn()
        .mockResolvedValue([
          { moduleItem: { module: { courseId: 'c1' } } },
          { moduleItem: { module: { courseId: 'c2' } } },
        ]),
      updateMany: jest.fn().mockResolvedValue({ count: 1 }),
    },
    promptLabTestCase: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) },
  };
}

describe('TextConsentService', () => {
  const lessonEvent = (courseId: string) => ({
    courseId,
    metadata: {
      libraryVersion: 'v2',
      event: 'answer_saved',
      text: 'my answer',
      parts: ['a'],
      chars: 9,
    } as Record<string, unknown>,
  });

  it('strips free text without consent (a), keeps chars and non-lesson events', async () => {
    const svc = new TextConsentService(consentPrisma([]) as never);
    const other = { courseId: 'c1', metadata: { text: 'chat note' } as Record<string, unknown> };
    const [lesson, untouched] = await svc.stripUnconsentedText('stu', [lessonEvent('c1'), other]);
    expect(lesson!.metadata).toEqual({ libraryVersion: 'v2', event: 'answer_saved', chars: 9 });
    expect(untouched).toBe(other);
  });

  it('keeps text when the latest decision gives (a); revocation wins', async () => {
    const given = new TextConsentService(
      consentPrisma([
        { studentId: 'stu', courseId: 'c1', answerText: true, decidedAt: new Date(NOW - 1000) },
      ]) as never,
    );
    expect(
      (await given.stripUnconsentedText('stu', [lessonEvent('c1')]))[0]!.metadata,
    ).toHaveProperty('text');

    const revoked = new TextConsentService(
      consentPrisma([
        { studentId: 'stu', courseId: 'c1', answerText: true, decidedAt: new Date(NOW - 2000) },
        { studentId: 'stu', courseId: 'c1', answerText: false, decidedAt: new Date(NOW - 1000) },
      ]) as never,
    );
    expect(
      (await revoked.stripUnconsentedText('stu', [lessonEvent('c1')]))[0]!.metadata,
    ).not.toHaveProperty('text');
  });

  it("researchConsenting uses each learner's latest decision", async () => {
    const svc = new TextConsentService(
      consentPrisma([
        { studentId: 'a', courseId: 'c1', researchUse: true, decidedAt: new Date(NOW - 3000) },
        { studentId: 'a', courseId: 'c1', researchUse: false, decidedAt: new Date(NOW - 1000) },
        { studentId: 'b', courseId: 'c1', researchUse: true, decidedAt: new Date(NOW - 1000) },
      ]) as never,
    );
    expect([...(await svc.researchConsenting('c1'))]).toEqual(['b']);
  });

  it('decide requires an active enrollment', async () => {
    const prisma = consentPrisma([]);
    prisma.enrollment.findUnique.mockResolvedValue({ status: 'DROPPED' });
    const svc = new TextConsentService(prisma as never);
    await expect(
      svc.decide('stu', 'c1', { answerText: true, promptsAndOutputs: false, researchUse: false }),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('scrubs Prompt Lab text on session close only where (b) is not given', async () => {
    const prisma = consentPrisma([
      { studentId: 'stu', courseId: 'c2', promptsAndOutputs: true, decidedAt: new Date(NOW) },
    ]);
    const svc = new TextConsentService(prisma as never);
    expect(await svc.scrubForSession('sess')).toEqual({ runs: 2, versions: 1, testCases: 3 });
    expect(prisma.promptLabRun.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { studentId: 'stu', retainText: false, textScrubbedAt: null },
      }),
    );
    // only c1 (no consent) had versions/test cases blanked
    expect(prisma.promptLabVersion.updateMany).toHaveBeenCalledTimes(1);
    expect(
      prisma.promptLabVersion.updateMany.mock.calls[0]![0].where.moduleItem.module.courseId,
    ).toBe('c1');
  });
});

describe('NudgeService', () => {
  const policy = {
    id: 'pol-1',
    courseId: 'c1',
    ruleId: 'M28',
    enabled: true,
    requiresValidated: true,
    messageTemplate: 'msg',
    rationale: 'why',
    maxPerActivity: 1,
    cooldownMinutes: 30,
    abTreatmentShare: null as number | null,
  };
  const draft = (id: string) => ({
    ruleId: 'M28',
    outcome: 'unreflective_regeneration_candidate',
    start: NOW - 5000,
    end: NOW - 1000,
    sources: [{ id }],
    slideKey: 's3',
  });

  function setup(
    opts: { policies?: (typeof policy)[]; validated?: string[]; prior?: unknown[] } = {},
  ) {
    const prisma = {
      moduleItem: { findUnique: jest.fn().mockResolvedValue({ module: { courseId: 'c1' } }) },
      studentSession: { findUnique: jest.fn().mockResolvedValue({ userId: 'stu' }) },
      interventionPolicy: {
        findMany: jest.fn().mockResolvedValue(opts.policies ?? [policy]),
        upsert: jest.fn(),
        findUnique: jest.fn().mockResolvedValue({ ...policy, enabled: false }),
        update: jest.fn(({ data }) => Promise.resolve({ ...policy, ...data })),
      },
      learningEventParameterSet: { findFirst: jest.fn().mockResolvedValue(null) },
      activityLog: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'a1',
            action: 'X',
            occurredAt: new Date(NOW - 1000),
            courseId: 'c1',
            moduleItemId: 'i1',
            interventionId: null,
            metadata: {},
          },
        ]),
        create: jest.fn(),
      },
      ruleNudge: {
        findMany: jest.fn().mockResolvedValue(opts.prior ?? []),
        create: jest.fn(({ data }) => Promise.resolve({ id: 'n1', ...data })),
      },
    };
    const validation = {
      validatedRuleIds: jest.fn().mockResolvedValue(new Set(opts.validated ?? ['M28'])),
    };
    return { prisma, svc: new NudgeService(prisma as never, validation as never) };
  }
  const body = { moduleItemId: 'i1', sessionId: 'sess' };

  beforeEach(() => runRules.mockReset().mockReturnValue([draft('a1')]));

  it('does nothing when no policy is enabled', async () => {
    const { svc, prisma } = setup({ policies: [] });
    expect(await svc.evaluate('stu', body)).toEqual({ nudge: null });
    expect(runRules).not.toHaveBeenCalled();
    expect(prisma.ruleNudge.create).not.toHaveBeenCalled();
  });

  it('ignores enabled policies whose rule is not validated', async () => {
    const { svc } = setup({ validated: [] });
    expect(await svc.evaluate('stu', body)).toEqual({ nudge: null });
    expect(runRules).not.toHaveBeenCalled();
  });

  it("rejects another learner's session", async () => {
    const { svc, prisma } = setup();
    prisma.studentSession.findUnique.mockResolvedValue({ userId: 'other' });
    await expect(svc.evaluate('stu', body)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('shows a nudge and logs it as rule_triggered', async () => {
    const { svc, prisma } = setup();
    const res = await svc.evaluate('stu', body);
    expect(res.nudge).toMatchObject({
      id: 'n1',
      ruleId: 'M28',
      message: 'msg',
      rationale: 'why',
      slideKey: 's3',
    });
    expect(prisma.activityLog.create.mock.calls[0]![0].data).toMatchObject({
      action: 'INTERVENTION_TRIGGERED',
      interventionId: 'n1',
      metadata: { triggerReason: 'rule_triggered', ruleId: 'M28', arm: 'treatment', shown: true },
    });
  });

  it('respects the per-activity cap, cooldown and source dedupe', async () => {
    const shown = {
      moduleItemId: 'i1',
      status: 'shown',
      createdAt: new Date(NOW - 60 * 60_000),
      triggerDetail: { sourceKey: 'zz' },
    };
    expect((await setup({ prior: [shown] }).svc.evaluate('stu', body)).nudge).toBeNull();

    const recentElsewhere = { ...shown, moduleItemId: 'i9', createdAt: new Date(NOW - 60_000) };
    expect((await setup({ prior: [recentElsewhere] }).svc.evaluate('stu', body)).nudge).toBeNull();

    const sameSource = { ...shown, moduleItemId: 'i9', triggerDetail: { sourceKey: 'a1' } };
    expect((await setup({ prior: [sameSource] }).svc.evaluate('stu', body)).nudge).toBeNull();

    const oldElsewhere = { ...shown, moduleItemId: 'i9' };
    expect((await setup({ prior: [oldElsewhere] }).svc.evaluate('stu', body)).nudge).not.toBeNull();
  });

  it('withholds for the control arm but still logs it', async () => {
    const { svc, prisma } = setup({ policies: [{ ...policy, abTreatmentShare: 0 }] });
    expect(await svc.evaluate('stu', body)).toEqual({ nudge: null });
    expect(prisma.ruleNudge.create.mock.calls[0]![0].data).toMatchObject({
      arm: 'control',
      status: 'withheld',
    });
    expect(prisma.activityLog.create.mock.calls[0]![0].data.metadata).toMatchObject({
      shown: false,
    });
  });

  it('assigns arms deterministically', () => {
    expect(NudgeService.arm('stu', 'p', null)).toBe('treatment');
    expect(NudgeService.arm('stu', 'p', 1)).toBe('treatment');
    expect(NudgeService.arm('stu', 'p', 0)).toBe('control');
    const a = NudgeService.arm('stu', 'p', 0.5);
    expect(NudgeService.arm('stu', 'p', 0.5)).toBe(a);
  });

  it('refuses to enable an unvalidated rule unless requiresValidated is turned off', async () => {
    const { svc } = setup({ validated: [] });
    await expect(svc.updatePolicy('c1', 'M28', { enabled: true }, 'res')).rejects.toBeInstanceOf(
      BadRequestException,
    );
    await expect(
      svc.updatePolicy('c1', 'M28', { enabled: true, requiresValidated: false }, 'res'),
    ).resolves.toMatchObject({ enabled: true, requiresValidated: false });
  });
});
