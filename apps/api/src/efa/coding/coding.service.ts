import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import {
  EFA_CODED_TASKS,
  EFA_W4_CODES,
  EFA_W5_CODES,
  type EfaCodedTask,
  type EfaCodingEntry,
  type EfaCodingItem,
  type EfaCodingSummary,
  type EfaEntryCode,
} from '@ats/shared';
import { PrismaService } from '../../prisma';
import { EfaOccasionService } from '../occasion.service';
import { cohensKappa, prescoreW4 } from '../scoring/scoring';
import { EfaScoringService } from '../scoring/scoring.service';
import { assertEfaStaff, type EfaStaff } from '../staff-access';

/**
 * Rater coding of W4 word-list entries and W5 Part B completions
 * (docs/EF_battery_v2/IMPLEMENTATION_PLAN.md §7).
 *
 * - The unit shown to a rater is one trial (a W4 list or a W5 sentence);
 *   codes are per entry. Items carry no student, occasion or run id and
 *   come in a per-rater random order.
 * - Two raters per entry. Who may rate a task: the users in
 *   efa_rater_assignments for it, or the course owner and admins if none.
 * - Two agreeing codes become the final code (source rater_agree); a
 *   disagreement waits for adjudication (source adjudicated) by the course
 *   owner or an admin, who alone see both raters' codes. Every change
 *   of final codes re-scores the run.
 */

type CodedTrial = Awaited<ReturnType<EfaCodingService['trials']>>[number];
type Code = { code: string; category: string | null };

const RATERS_PER_ENTRY = 2;
const TRIAL_INCLUDE = {
  codes: { orderBy: { createdAt: 'asc' as const } },
  finalCodes: true,
  taskRun: {
    select: {
      id: true,
      taskCode: true,
      status: true,
      occasion: { select: { form: true, courseId: true } },
    },
  },
};
const same = (a: Code, b: Code) =>
  a.code === b.code && (a.category ?? null) === (b.category ?? null);
const label = (c: Code) => (c.category ? `${c.code}:${c.category}` : c.code);
const HINTS = {
  repeat: 'repeat',
  sameRoot: 'same root',
  wrongLetter: 'wrong letter',
  likelyName: 'likely name',
} as const;

@Injectable()
export class EfaCodingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly occasions: EfaOccasionService,
    private readonly scoring: EfaScoringService,
  ) {}

  private task(task: string): EfaCodedTask {
    if (!(EFA_CODED_TASKS as readonly string[]).includes(task))
      throw new NotFoundException('Not found');
    return task as EfaCodedTask;
  }

  private async trials(courseId: string, task: EfaCodedTask) {
    return this.prisma.efaTrial.findMany({
      where: {
        phase: 'test',
        ...(task === 'w5' ? { part: 'B' } : {}),
        taskRun: {
          taskCode: task,
          status: { in: ['completed', 'interrupted'] },
          occasion: { courseId },
        },
      },
      include: TRIAL_INCLUDE,
    });
  }

  private entries(task: EfaCodedTask, t: { response: unknown }): string[] {
    if (task === 'w4')
      return ((t.response as { entries?: Array<{ text: string }> })?.entries ?? []).map(
        (e) => e.text,
      );
    return [String((t.response as { raw?: string } | null)?.raw ?? '')];
  }

  /** The first two raters' codes for one entry. */
  private pair(t: CodedTrial, entryIndex: number) {
    const raters: string[] = [];
    const codes: Code[] = [];
    for (const c of t.codes) {
      if (c.entryIndex !== entryIndex || raters.includes(c.raterId)) continue;
      raters.push(c.raterId);
      codes.push({ code: c.code, category: c.category });
      if (raters.length === RATERS_PER_ENTRY) break;
    }
    return { raters, codes };
  }

  private async canCode(staff: EfaStaff, courseId: string, task: EfaCodedTask) {
    const assigned = await this.prisma.efaRaterAssignment.findMany({
      where: { courseId, taskCode: task },
      select: { raterId: true },
    });
    if (assigned.length) return assigned.some((a) => a.raterId === staff.id);
    // No raters named for this puzzle: the course's own staff code it.
    if (staff.role === 'admin') return true;
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    return course?.teacherId === staff.id;
  }

  private order(staff: EfaStaff, trialId: string) {
    return createHash('sha256').update(`${staff.id}:${trialId}`).digest('hex');
  }

  private async view(
    t: CodedTrial,
    task: EfaCodedTask,
    staff: EfaStaff,
    mode: 'code' | 'adjudicate',
  ): Promise<EfaCodingItem> {
    const texts = this.entries(task, t);
    const stim = t.stimulus as Record<string, unknown> | string;
    const finals = new Map(t.finalCodes.map((f) => [f.entryIndex, f]));
    const base = (i: number): EfaCodingEntry => {
      const mine = t.codes.find((c) => c.entryIndex === i && c.raterId === staff.id);
      const f = finals.get(i);
      return {
        entryIndex: i,
        text: texts[i] ?? '',
        mine: mine ? { code: mine.code, category: mine.category } : null,
        ...(mode === 'adjudicate'
          ? {
              raters: this.pair(t, i).codes,
              final: f ? { code: f.code, category: f.category, source: f.source } : null,
            }
          : {}),
      };
    };

    if (task === 'w4') {
      const s = stim as { prompt: string; letter?: string; category?: string; pair?: string[] };
      const entries =
        (t.response as { entries?: Array<{ text: string; atMs: number }> })?.entries ?? [];
      const pre = prescoreW4(entries, s.letter);
      return {
        itemId: t.id,
        task,
        prompt: { kind: s.prompt, letter: s.letter, category: s.category, pair: s.pair },
        ...(s.pair ? { categories: s.pair } : {}),
        entries: texts.map((_, i) => ({
          ...base(i),
          hints: (Object.keys(HINTS) as Array<keyof typeof HINTS>)
            .filter((k) => pre[i]?.[k])
            .map((k) => HINTS[k]),
        })),
      };
    }

    const set = await this.occasions.stimulusSet();
    const form = t.taskRun.occasion.form as 'A' | 'B' | 'C';
    const expected = set.data.forms[form]?.hay.B[t.trialIndex]?.[1] ?? '';
    const normalised = String((t.response as { normalised?: string } | null)?.normalised ?? '');
    return {
      itemId: t.id,
      task,
      prompt: { kind: 'sentence', sentence: String(stim) },
      expected,
      anchors: set.extras.hayling.codingExamples[expected] ?? null,
      entries: [
        { ...base(0), suggested: normalised && normalised === expected.toLowerCase() ? 'A' : null },
      ],
    };
  }

  // ── rater queue ─────────────────────────────────────────────────────────

  async queue(staff: EfaStaff, courseId: string, taskParam: string, limit = 10) {
    await assertEfaStaff(this.prisma, staff, courseId, { raters: true });
    const task = this.task(taskParam);
    if (!(await this.canCode(staff, courseId, task)))
      throw new ForbiddenException('You are not a rater for this puzzle.');
    const open = (await this.trials(courseId, task)).filter((t) => {
      const n = this.entries(task, t).length;
      if (!n) return false;
      for (let i = 0; i < n; i++) {
        const { raters } = this.pair(t, i);
        if (!raters.includes(staff.id) && raters.length < RATERS_PER_ENTRY) return true;
      }
      return false;
    });
    open.sort((a, b) => this.order(staff, a.id).localeCompare(this.order(staff, b.id)));
    const items = await Promise.all(
      open.slice(0, limit).map((t) => this.view(t, task, staff, 'code')),
    );
    return { remaining: open.length, items };
  }

  private validate(task: EfaCodedTask, t: CodedTrial, codes: EfaEntryCode[]) {
    const n = this.entries(task, t).length;
    const allowed: readonly string[] = task === 'w4' ? EFA_W4_CODES : EFA_W5_CODES;
    const pair = (t.stimulus as { pair?: string[] })?.pair;
    for (const c of codes) {
      if (c.entryIndex >= n) throw new BadRequestException(`No entry ${c.entryIndex}`);
      if (!allowed.includes(c.code))
        throw new BadRequestException(`Code ${c.code} does not apply here`);
      if (pair && c.code === 'valid' && !pair.includes(c.category ?? ''))
        throw new BadRequestException('Choose the category of each valid word');
    }
  }

  private async trialFor(courseId: string, trialId: string) {
    const t = await this.prisma.efaTrial.findUnique({
      where: { id: trialId },
      include: TRIAL_INCLUDE,
    });
    const task = t?.taskRun.taskCode as EfaCodedTask | undefined;
    if (
      !t ||
      !task ||
      !EFA_CODED_TASKS.includes(task) ||
      t.phase !== 'test' ||
      (task === 'w5' && t.part !== 'B') ||
      !['completed', 'interrupted'].includes(t.taskRun.status) ||
      t.taskRun.occasion.courseId !== courseId
    )
      throw new NotFoundException('Not found');
    return { task, t };
  }

  async submit(staff: EfaStaff, courseId: string, trialId: string, codes: EfaEntryCode[]) {
    await assertEfaStaff(this.prisma, staff, courseId, { raters: true });
    const { task, t } = await this.trialFor(courseId, trialId);
    if (!(await this.canCode(staff, courseId, task)))
      throw new ForbiddenException('You are not a rater for this puzzle.');
    this.validate(task, t, codes);
    for (const c of codes) {
      const { raters } = this.pair(t, c.entryIndex);
      if (!raters.includes(staff.id) && raters.length >= RATERS_PER_ENTRY)
        throw new ConflictException('Two raters have already coded this item.');
    }
    await this.prisma.$transaction(
      codes.map((c) =>
        this.prisma.efaCode.upsert({
          where: {
            trialId_entryIndex_raterId: { trialId, entryIndex: c.entryIndex, raterId: staff.id },
          },
          create: {
            trialId,
            entryIndex: c.entryIndex,
            raterId: staff.id,
            code: c.code,
            category: c.category ?? null,
          },
          update: { code: c.code, category: c.category ?? null },
        }),
      ),
    );
    return this.reconcile(courseId, trialId);
  }

  /** Two agreeing codes → final (rater_agree); a revised disagreement removes an agreed final. Adjudications stay. */
  private async reconcile(courseId: string, trialId: string) {
    const { task, t } = await this.trialFor(courseId, trialId);
    let changed = false;
    const finals = new Map(t.finalCodes.map((f) => [f.entryIndex, f]));
    for (let i = 0; i < this.entries(task, t).length; i++) {
      const { codes } = this.pair(t, i);
      const f = finals.get(i);
      if (f?.source === 'adjudicated') continue;
      if (codes.length === RATERS_PER_ENTRY && same(codes[0]!, codes[1]!)) {
        if (f && same(f, codes[0]!)) continue;
        const data = {
          code: codes[0]!.code,
          category: codes[0]!.category,
          source: 'rater_agree',
          adjudicatedBy: null,
        };
        await this.prisma.efaFinalCode.upsert({
          where: { trialId_entryIndex: { trialId, entryIndex: i } },
          create: { trialId, entryIndex: i, ...data },
          update: data,
        });
        changed = true;
      } else if (f) {
        await this.prisma.efaFinalCode.delete({ where: { id: f.id } });
        changed = true;
      }
    }
    if (changed) await this.scoring.scoreRun(t.taskRun.id);
    return { ok: true, finalsChanged: changed };
  }

  // ── disagreements and adjudication ──────────────────────────────────────

  async disagreements(staff: EfaStaff, courseId: string, taskParam: string) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const task = this.task(taskParam);
    const open = (await this.trials(courseId, task)).filter((t) =>
      this.entries(task, t).some((_, i) => {
        const { codes } = this.pair(t, i);
        const f = t.finalCodes.find((x) => x.entryIndex === i);
        return (
          codes.length === RATERS_PER_ENTRY &&
          !same(codes[0]!, codes[1]!) &&
          f?.source !== 'adjudicated'
        );
      }),
    );
    open.sort((a, b) => this.order(staff, a.id).localeCompare(this.order(staff, b.id)));
    return { items: await Promise.all(open.map((t) => this.view(t, task, staff, 'adjudicate'))) };
  }

  async adjudicate(staff: EfaStaff, courseId: string, trialId: string, codes: EfaEntryCode[]) {
    await assertEfaStaff(this.prisma, staff, courseId);
    const { task, t } = await this.trialFor(courseId, trialId);
    this.validate(task, t, codes);
    await this.prisma.$transaction(
      codes.map((c) => {
        const data = {
          code: c.code,
          category: c.category ?? null,
          source: 'adjudicated',
          adjudicatedBy: staff.id,
        };
        return this.prisma.efaFinalCode.upsert({
          where: { trialId_entryIndex: { trialId, entryIndex: c.entryIndex } },
          create: { trialId, entryIndex: c.entryIndex, ...data },
          update: data,
        });
      }),
    );
    await this.scoring.scoreRun(t.taskRun.id);
    return { ok: true };
  }

  // ── progress and agreement ──────────────────────────────────────────────

  async summary(staff: EfaStaff, courseId: string): Promise<EfaCodingSummary[]> {
    await assertEfaStaff(this.prisma, staff, courseId, { raters: true });
    const out: EfaCodingSummary[] = [];
    for (const task of EFA_CODED_TASKS) {
      const trials = (await this.trials(courseId, task)).filter(
        (t) => this.entries(task, t).length,
      );
      let entries = 0;
      let mine = 0;
      let double = 0;
      let disagreements = 0;
      let finalised = 0;
      const pairs: Array<[string, string]> = [];
      for (const t of trials) {
        for (let i = 0; i < this.entries(task, t).length; i++) {
          entries++;
          const { raters, codes } = this.pair(t, i);
          const f = t.finalCodes.find((x) => x.entryIndex === i);
          if (raters.includes(staff.id)) mine++;
          if (f) finalised++;
          if (codes.length < RATERS_PER_ENTRY) continue;
          double++;
          pairs.push([label(codes[0]!), label(codes[1]!)]);
          if (!same(codes[0]!, codes[1]!) && f?.source !== 'adjudicated') disagreements++;
        }
      }
      out.push({
        task,
        items: trials.length,
        entries,
        codedByMe: mine,
        doubleCoded: double,
        disagreements,
        finalised,
        kappa: cohensKappa(pairs),
        canCode: await this.canCode(staff, courseId, task),
      });
    }
    return out;
  }
}
