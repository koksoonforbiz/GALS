import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma';
import { resolveParams } from '../engine/params';
import { prepareActions } from '../engine/prepare';
import { runRules } from '../engine/rules';
import type { Draft, RawAction } from '../engine/types';
import { ValidationService } from '../validation/validation.service';

/**
 * Starter policies (plan Phase 6.1 #3). All created DISABLED. Each nudge says
 * why it appeared (rationale), is dismissible, carries no penalty, and only
 * fires on the rule outcome the plan's table describes.
 */
export const STARTER_POLICIES: Array<{
  ruleId: string;
  outcomes: string[] | null;
  messageTemplate: string;
  rationale: string;
}> = [
  {
    ruleId: 'M31',
    outcomes: ['passive_reliance_candidate'],
    messageTemplate: 'Before using this, check one claim and name one change.',
    rationale: 'You pasted text from an AI output without editing or checking it.',
  },
  {
    ruleId: 'M28',
    outcomes: ['unreflective_regeneration_candidate'],
    messageTemplate:
      'Before running it again: what exactly is wrong with the last output? Check it against the rubric.',
    rationale: 'You re-ran the prompt quickly without rating or testing the previous output.',
  },
  {
    ruleId: 'M15',
    outcomes: ['reference_exposure'],
    messageTemplate: 'Name one thing your answer missed or would change.',
    rationale: 'You opened the reference answer but did not note what you missed.',
  },
  {
    ruleId: 'M16',
    outcomes: ['persistent_misconception'],
    messageTemplate: 'Want to look at the related theory slide again before moving on?',
    rationale:
      'You agreed with a claim the course treats as a misconception, and your reason did not change after the explanation.',
  },
  {
    ruleId: 'M24',
    outcomes: ['low_effort_candidate'],
    messageTemplate: 'Add a sentence on why — it makes the reveal more useful. (No penalty.)',
    rationale:
      'Your answer was short and quick, so the comparison with the reference may tell you less.',
  },
  {
    ruleId: 'M25',
    outcomes: null,
    messageTemplate: 'Welcome back. A 2-minute recap: what was the last idea you were working on?',
    rationale: 'You were away from the lesson for a while.',
  },
];

const OUTCOMES = new Map(STARTER_POLICIES.map((p) => [p.ruleId, p.outcomes]));
const LOOKBACK_MS = 20 * 60_000;
const RECENT_MS = 2 * 60_000;

export interface PolicyUpdate {
  enabled?: boolean;
  requiresValidated?: boolean;
  messageTemplate?: string;
  rationale?: string;
  maxPerActivity?: number;
  cooldownMinutes?: number;
  abTreatmentShare?: number | null;
}

/**
 * Rule-triggered interventions (plan Phase 6.1): the first non-student-
 * initiated intervention path in GALS. Nothing fires unless a researcher has
 * enabled a policy for the course — and, by default, validated its rule.
 * Every decision (shown or withheld for the control arm) is logged in
 * rule_nudges and as INTERVENTION_TRIGGERED with triggerReason 'rule_triggered'.
 */
@Injectable()
export class NudgeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly validation: ValidationService,
  ) {}

  // ── policies (researcher) ────────────────────────────────────────────────

  async policies(courseId: string) {
    for (const p of STARTER_POLICIES) {
      await this.prisma.interventionPolicy.upsert({
        where: { courseId_ruleId: { courseId, ruleId: p.ruleId } },
        create: {
          courseId,
          ruleId: p.ruleId,
          messageTemplate: p.messageTemplate,
          rationale: p.rationale,
        },
        update: {},
      });
    }
    const [rows, validated] = await Promise.all([
      this.prisma.interventionPolicy.findMany({ where: { courseId }, orderBy: { ruleId: 'asc' } }),
      this.validation.validatedRuleIds(),
    ]);
    return rows.map((r) => ({ ...r, ruleValidated: validated.has(r.ruleId) }));
  }

  async updatePolicy(courseId: string, ruleId: string, update: PolicyUpdate, updatedBy: string) {
    await this.policies(courseId);
    const current = await this.prisma.interventionPolicy.findUnique({
      where: { courseId_ruleId: { courseId, ruleId } },
    });
    if (!current) throw new NotFoundException(`No policy for ${ruleId}`);
    const next = { ...current, ...update };
    if (
      next.enabled &&
      next.requiresValidated &&
      !(await this.validation.validatedRuleIds()).has(ruleId)
    ) {
      throw new BadRequestException(
        `${ruleId} is not validated. Validate it first, or set requiresValidated: false explicitly (test courses only).`,
      );
    }
    if (next.abTreatmentShare != null && (next.abTreatmentShare < 0 || next.abTreatmentShare > 1)) {
      throw new BadRequestException('abTreatmentShare must be between 0 and 1');
    }
    return this.prisma.interventionPolicy.update({
      where: { id: current.id },
      data: { ...update, updatedBy },
    });
  }

  async log(courseId: string) {
    return this.prisma.ruleNudge.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      take: 500,
    });
  }

  // ── evaluation (student) ─────────────────────────────────────────────────

  /** Deterministic A/B arm per learner and policy. */
  static arm(studentId: string, policyId: string, share: number | null): 'treatment' | 'control' {
    if (share == null) return 'treatment';
    const h = createHash('sha256').update(`${studentId}:${policyId}`).digest();
    return h.readUInt32BE(0) / 0xffffffff < share ? 'treatment' : 'control';
  }

  async evaluate(
    studentId: string,
    body: { moduleItemId: string; sessionId: string; slideKey?: string },
  ) {
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: body.moduleItemId },
      select: { module: { select: { courseId: true } } },
    });
    if (!item) throw new NotFoundException('Item not found');
    const courseId = item.module.courseId;
    const session = await this.prisma.studentSession.findUnique({
      where: { id: body.sessionId },
      select: { userId: true },
    });
    if (session?.userId !== studentId) throw new ForbiddenException('Not your session');

    // Fast path: nothing enabled → nothing to evaluate.
    const policies = await this.prisma.interventionPolicy.findMany({
      where: { courseId, enabled: true },
    });
    if (!policies.length) return { nudge: null };
    const validated = await this.validation.validatedRuleIds();
    const active = policies.filter((p) => !p.requiresValidated || validated.has(p.ruleId));
    if (!active.length) return { nudge: null };

    const set = await this.prisma.learningEventParameterSet.findFirst({
      orderBy: { version: 'desc' },
    });
    const params = resolveParams(set?.values);
    const since = new Date(Date.now() - LOOKBACK_MS);
    const rows = await this.prisma.activityLog.findMany({
      where: {
        sessionId: body.sessionId,
        moduleItemId: body.moduleItemId,
        occurredAt: { gte: since },
      },
      select: {
        id: true,
        action: true,
        occurredAt: true,
        courseId: true,
        moduleItemId: true,
        interventionId: true,
        metadata: true,
      },
    });
    const { actions } = prepareActions(
      rows.map(
        (r): RawAction => ({
          id: r.id,
          action: r.action,
          at: r.occurredAt.getTime(),
          courseId: r.courseId,
          moduleItemId: r.moduleItemId,
          interventionId: r.interventionId,
          meta: (r.metadata ?? {}) as Record<string, unknown>,
        }),
      ),
    );
    if (!actions.length) return { nudge: null };
    const latest = actions[actions.length - 1]!.at;
    const drafts = runRules({
      actions,
      visibility: [],
      prior: { visits: new Map(), commits: new Set() },
      params,
    });

    const candidates: Array<{ draft: Draft; policy: (typeof active)[number] }> = [];
    for (const policy of active) {
      const allowed = OUTCOMES.get(policy.ruleId);
      for (const d of drafts) {
        if (d.ruleId !== policy.ruleId) continue;
        if (allowed && !allowed.includes(d.outcome ?? '')) continue;
        if (
          policy.ruleId === 'M15' &&
          (d.detail as { revealKind?: string } | undefined)?.revealKind !== 'check'
        )
          continue;
        if (latest - d.end > RECENT_MS) continue;
        candidates.push({ draft: d, policy });
      }
    }
    candidates.sort((a, b) => b.draft.end - a.draft.end);

    for (const { draft, policy } of candidates) {
      const sourceKey =
        draft.sources
          .map((s) => s.id)
          .sort()
          .join(',') || `${draft.ruleId}@${draft.start}`;
      const prior = await this.prisma.ruleNudge.findMany({
        where: { studentId, ruleId: policy.ruleId, courseId },
        select: { moduleItemId: true, status: true, createdAt: true, triggerDetail: true },
        orderBy: { createdAt: 'desc' },
      });
      if (
        prior.some(
          (p) => (p.triggerDetail as { sourceKey?: string } | null)?.sourceKey === sourceKey,
        )
      )
        continue;
      const shownHere = prior.filter(
        (p) => p.moduleItemId === body.moduleItemId && p.status !== 'withheld',
      ).length;
      if (shownHere >= policy.maxPerActivity) continue;
      const last = prior[0];
      if (last && Date.now() - last.createdAt.getTime() < policy.cooldownMinutes * 60_000) continue;

      const arm = NudgeService.arm(studentId, policy.id, policy.abTreatmentShare);
      const nudge = await this.prisma.ruleNudge.create({
        data: {
          policyId: policy.id,
          courseId,
          studentId,
          sessionId: body.sessionId,
          moduleItemId: body.moduleItemId,
          slideKey: draft.slideKey ?? body.slideKey ?? null,
          ruleId: policy.ruleId,
          arm,
          status: arm === 'treatment' ? 'shown' : 'withheld',
          triggerDetail: {
            sourceKey,
            outcome: draft.outcome ?? null,
            detail: draft.detail ?? null,
          } as Prisma.InputJsonValue,
        },
      });
      await this.prisma.activityLog.create({
        data: {
          sessionId: body.sessionId,
          userId: studentId,
          action: 'INTERVENTION_TRIGGERED',
          courseId,
          moduleItemId: body.moduleItemId,
          interventionId: nudge.id,
          metadata: {
            triggerReason: 'rule_triggered',
            ruleId: policy.ruleId,
            policyId: policy.id,
            arm,
            shown: arm === 'treatment',
            slideKey: nudge.slideKey,
          },
        },
      });
      if (arm === 'control') return { nudge: null };
      return {
        nudge: {
          id: nudge.id,
          ruleId: policy.ruleId,
          message: policy.messageTemplate,
          rationale: policy.rationale,
          slideKey: nudge.slideKey,
        },
      };
    }
    return { nudge: null };
  }

  async respond(studentId: string, nudgeId: string, status: 'accepted' | 'dismissed') {
    const n = await this.prisma.ruleNudge.findUnique({ where: { id: nudgeId } });
    if (!n || n.studentId !== studentId) throw new NotFoundException('Nudge not found');
    if (n.status !== 'shown') return n;
    return this.prisma.ruleNudge.update({
      where: { id: nudgeId },
      data: { status, respondedAt: new Date() },
    });
  }
}
