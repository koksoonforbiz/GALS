import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import type { Prisma, PromptLabRun } from '@prisma/client';
import type {
  LessonDocument,
  PromptLabRatingRequest,
  PromptLabRunRequest,
  PromptLabTestCaseRequest,
  PromptLabTestResultRequest,
  PromptLabVersionRequest,
} from '@ats/shared';
import { PrismaService } from '../prisma';
import { LlmService } from '../rag/llm.service';
import { isSelectable, listChatModels, type LlmProvider } from '../llm/model-registry';
import { approxTokens, wordDiffStats } from './text-diff';
import { TextConsentService } from '../governance/text-consent.service';

/** Slide types whose lab work runs in the Prompt Lab (external AI tool in the HTML). */
const LAB_SLIDE_TYPES = new Set(['exercise', 'task', 'stretch']);

/**
 * Neutral system prompt when the learner sets none — recorded on the run so
 * analysis knows exactly what the model saw (a plain chat tool, which is
 * what the course's external-tool instructions assume).
 */
export const PROMPT_LAB_DEFAULT_SYSTEM = 'You are a helpful assistant.';

function envInt(name: string, fallback: number): number {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

/** Decision #4 defaults (PHASE0_DISCOVERY.md §11), per student per course. */
export const promptLabLimits = () => ({
  runsPerHour: envInt('PROMPT_LAB_RUNS_PER_HOUR', 60),
  tokensPerDay: envInt('PROMPT_LAB_TOKENS_PER_DAY', 200_000),
});

@Injectable()
export class PromptLabService {
  private readonly logger = new Logger(PromptLabService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
    @Optional() private readonly consent?: TextConsentService,
  ) {}

  // ── access ──────────────────────────────────────────────────────────────

  private async authorizeStudent(studentId: string, moduleItemId: string, slideKey: string) {
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: moduleItemId },
      select: {
        type: true,
        lessonJson: true,
        module: { select: { courseId: true, course: { select: { teacherId: true } } } },
      },
    });
    if (!item || item.type !== 'INTERACTIVE_LESSON' || !item.lessonJson) {
      throw new NotFoundException('Interactive lesson not found');
    }
    const courseId = item.module.courseId;
    const enrollment = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { status: true },
    });
    if (enrollment?.status !== 'ACTIVE')
      throw new ForbiddenException('You are not enrolled in this course');
    const slide = (item.lessonJson as unknown as LessonDocument).slides.find(
      (s) => s.key === slideKey,
    );
    if (!slide || !LAB_SLIDE_TYPES.has(slide.t)) {
      throw new BadRequestException(`Slide "${slideKey}" has no Prompt Lab`);
    }
    return { courseId, teacherId: item.module.course.teacherId };
  }

  private async usage(studentId: string, courseId: string) {
    const now = Date.now();
    const [runsLastHour, tokens] = await Promise.all([
      this.prisma.promptLabRun.count({
        where: { studentId, courseId, createdAt: { gte: new Date(now - 3_600_000) } },
      }),
      this.prisma.promptLabRun.aggregate({
        where: { studentId, courseId, createdAt: { gte: new Date(now - 86_400_000) } },
        _sum: { promptTokens: true, completionTokens: true },
      }),
    ]);
    return {
      runsLastHour,
      tokensLast24h: (tokens._sum.promptTokens ?? 0) + (tokens._sum.completionTokens ?? 0),
      ...promptLabLimits(),
    };
  }

  // ── models ──────────────────────────────────────────────────────────────

  /** Models the learner may pick: the course teacher's provider, selectable only. */
  async models(courseId: string, teacherId: string) {
    const resolved = await this.llm.getResolvedChatModelForUser(teacherId);
    if (!resolved) {
      return {
        defaultModel: 'template',
        models: [
          {
            id: 'template',
            label: 'Built-in template (no LLM configured for this course)',
            supportsTemperature: false,
          },
        ],
        courseId,
      };
    }
    const models = listChatModels(resolved.provider as LlmProvider)
      .filter((m) => isSelectable(m.id))
      .map((m) => ({ id: m.id, label: m.label, supportsTemperature: m.supportsTemperature }));
    return { defaultModel: resolved.spec.id, models, courseId };
  }

  // ── runs ────────────────────────────────────────────────────────────────

  async run(studentId: string, dto: PromptLabRunRequest) {
    const { courseId, teacherId } = await this.authorizeStudent(
      studentId,
      dto.moduleItemId,
      dto.slideKey,
    );
    const samples = dto.samples ?? 1;

    const use = await this.usage(studentId, courseId);
    if (use.runsLastHour + samples > use.runsPerHour) {
      throw new HttpException(
        `Prompt Lab limit reached: ${use.runsPerHour} runs per hour. Try again later.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    if (use.tokensLast24h >= use.tokensPerDay) {
      throw new HttpException(
        `Prompt Lab limit reached: ${use.tokensPerDay.toLocaleString()} tokens per day.`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    let version: { id: string; versionNo: number } | null = null;
    if (dto.versionId) {
      version = await this.prisma.promptLabVersion.findFirst({
        where: {
          id: dto.versionId,
          studentId,
          moduleItemId: dto.moduleItemId,
          slideKey: dto.slideKey,
        },
        select: { id: true, versionNo: true },
      });
      if (!version) throw new BadRequestException('Unknown prompt version');
    }
    if (dto.parentRunId) {
      const parent = await this.prisma.promptLabRun.findFirst({
        where: { id: dto.parentRunId, studentId },
        select: { id: true },
      });
      if (!parent) throw new BadRequestException('Unknown parent run');
    }
    let caseInput: string | null = null;
    if (dto.testCaseKey) {
      const tc = await this.prisma.promptLabTestCase.findUnique({
        where: {
          studentId_moduleItemId_slideKey_caseKey: {
            studentId,
            moduleItemId: dto.moduleItemId,
            slideKey: dto.slideKey,
            caseKey: dto.testCaseKey,
          },
        },
        select: { inputText: true },
      });
      if (!tc) throw new BadRequestException('Unknown test case');
      caseInput = tc.inputText;
    }

    const systemText = dto.systemText?.trim() ? dto.systemText : PROMPT_LAB_DEFAULT_SYSTEM;
    // Consent (b): without it the text is a working copy for this session
    // only and is scrubbed when the session closes (TextConsentService).
    const retainText = this.consent
      ? ((await this.consent.current(studentId, courseId))?.promptsAndOutputs ?? false)
      : true;
    // A test case is appended to the prompt version as the question it is
    // tested on (course labs: "test each version on both questions").
    const userText = caseInput ? `${dto.promptText}\n\n---\n${caseInput}` : dto.promptText;

    const runs: PromptLabRun[] = [];
    let firstRunId: string | null = null;
    for (let i = 1; i <= samples; i++) {
      const started = Date.now();
      const result = await this.llm.callLlmStructured(
        teacherId,
        {
          systemPrompt: systemText,
          messages: [{ role: 'user', content: userText }],
          temperature: dto.temperature,
          maxTokens: dto.maxTokens,
          model: dto.model && dto.model !== 'template' ? dto.model : undefined,
        },
        { feature: 'prompt_lab', courseId, triggeredByUserId: studentId },
      );
      const created: PromptLabRun = await this.prisma.promptLabRun.create({
        data: {
          studentId,
          studentSessionId: dto.sessionId ?? null,
          courseId,
          moduleItemId: dto.moduleItemId,
          slideKey: dto.slideKey,
          versionId: version?.id ?? null,
          versionNo: version?.versionNo ?? null,
          parentRunId: i === 1 ? (dto.parentRunId ?? null) : firstRunId,
          testCaseKey: dto.testCaseKey ?? null,
          declaredExperiment: samples > 1,
          sampleNo: i,
          promptText: dto.promptText,
          systemText,
          model: result.model ?? 'template',
          provider: result.provider ?? 'template',
          temperature: dto.temperature ?? null,
          maxTokens: dto.maxTokens ?? null,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
          responseText: result.content,
          latencyMs: Date.now() - started,
          retainText,
        },
      });
      if (i === 1) firstRunId = created.id;
      runs.push(created);
    }
    return { runs, usage: await this.usage(studentId, courseId) };
  }

  // ── versions ────────────────────────────────────────────────────────────

  async saveVersion(studentId: string, dto: PromptLabVersionRequest) {
    await this.authorizeStudent(studentId, dto.moduleItemId, dto.slideKey);
    const prev = await this.prisma.promptLabVersion.findFirst({
      where: { studentId, moduleItemId: dto.moduleItemId, slideKey: dto.slideKey },
      orderBy: { versionNo: 'desc' },
      select: { versionNo: true, promptText: true },
    });
    const diff = prev ? wordDiffStats(prev.promptText, dto.promptText) : null;
    return this.prisma.promptLabVersion.create({
      data: {
        studentId,
        moduleItemId: dto.moduleItemId,
        slideKey: dto.slideKey,
        versionNo: (prev?.versionNo ?? 0) + 1,
        promptText: dto.promptText,
        tokenCount: approxTokens(dto.promptText),
        tokenCountSource: 'approx_chars4',
        revisionTags: dto.revisionTags ?? [],
        diffFromPrev: (diff ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  }

  async setTags(studentId: string, versionId: string, revisionTags: string[]) {
    const v = await this.prisma.promptLabVersion.findFirst({
      where: { id: versionId, studentId },
      select: { id: true },
    });
    if (!v) throw new NotFoundException('Version not found');
    return this.prisma.promptLabVersion.update({
      where: { id: versionId },
      data: { revisionTags },
    });
  }

  // ── test cases / results / ratings ──────────────────────────────────────

  async addTestCase(studentId: string, dto: PromptLabTestCaseRequest) {
    await this.authorizeStudent(studentId, dto.moduleItemId, dto.slideKey);
    const n = await this.prisma.promptLabTestCase.count({
      where: { studentId, moduleItemId: dto.moduleItemId, slideKey: dto.slideKey },
    });
    if (n >= 20) throw new BadRequestException('At most 20 test cases per lab');
    return this.prisma.promptLabTestCase.create({
      data: {
        studentId,
        moduleItemId: dto.moduleItemId,
        slideKey: dto.slideKey,
        caseKey: `c${n + 1}`,
        label: dto.label,
        inputText: dto.inputText,
      },
    });
  }

  async recordTestResult(studentId: string, dto: PromptLabTestResultRequest) {
    const v = await this.prisma.promptLabVersion.findFirst({
      where: { id: dto.versionId, studentId },
      select: { id: true },
    });
    if (!v) throw new NotFoundException('Version not found');
    if (dto.runId) await this.assertOwnRun(studentId, dto.runId);
    const data = {
      runId: dto.runId ?? null,
      pass: dto.pass,
      failureReason: dto.pass ? null : (dto.failureReason ?? null),
      note: dto.note ?? null,
    };
    return this.prisma.promptLabTestResult.upsert({
      where: { versionId_testCaseKey: { versionId: dto.versionId, testCaseKey: dto.testCaseKey } },
      create: { studentId, versionId: dto.versionId, testCaseKey: dto.testCaseKey, ...data },
      update: data,
    });
  }

  async rate(studentId: string, dto: PromptLabRatingRequest) {
    await this.assertOwnRun(studentId, dto.runId);
    return this.prisma.promptLabOutputRating.create({
      data: {
        studentId,
        runId: dto.runId,
        criteria: dto.criteria as Prisma.InputJsonValue,
        verifiedClaim: dto.verifiedClaim ?? null,
        verifyVerdict: dto.verifyVerdict ?? null,
      },
    });
  }

  private async assertOwnRun(studentId: string, runId: string) {
    const r = await this.prisma.promptLabRun.findFirst({
      where: { id: runId, studentId },
      select: { id: true },
    });
    if (!r) throw new NotFoundException('Run not found');
  }

  // ── reads ───────────────────────────────────────────────────────────────

  private async snapshot(studentId: string, moduleItemId: string, slideKey: string) {
    const where = { studentId, moduleItemId, slideKey };
    const [runs, versions, testCases] = await Promise.all([
      this.prisma.promptLabRun.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: 50,
        include: { ratings: { orderBy: { createdAt: 'desc' }, take: 1 } },
      }),
      this.prisma.promptLabVersion.findMany({
        where,
        orderBy: { versionNo: 'asc' },
        include: { testResults: true },
      }),
      this.prisma.promptLabTestCase.findMany({ where, orderBy: { createdAt: 'asc' } }),
    ]);
    return { runs, versions, testCases };
  }

  async mine(studentId: string, moduleItemId: string, slideKey: string) {
    const { courseId, teacherId } = await this.authorizeStudent(studentId, moduleItemId, slideKey);
    const [snap, usage, models] = await Promise.all([
      this.snapshot(studentId, moduleItemId, slideKey),
      this.usage(studentId, courseId),
      this.models(courseId, teacherId),
    ]);
    return { ...snap, usage, ...models };
  }

  /** Teacher/researcher read (PRIVATE door): one student's Prompt Lab work in a course. */
  async forStudent(viewer: { id: string; role: string }, courseId: string, studentId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (viewer.role !== 'admin' && course.teacherId !== viewer.id) {
      throw new ForbiddenException('You can only view students in your own courses');
    }
    const [runs, versions, testCases] = await Promise.all([
      this.prisma.promptLabRun.findMany({
        where: { studentId, courseId },
        orderBy: { createdAt: 'asc' },
        include: { ratings: true },
      }),
      this.prisma.promptLabVersion.findMany({
        where: { studentId, moduleItem: { module: { courseId } } },
        orderBy: [{ slideKey: 'asc' }, { versionNo: 'asc' }],
        include: { testResults: true },
      }),
      this.prisma.promptLabTestCase.findMany({
        where: { studentId, moduleItem: { module: { courseId } } },
        orderBy: { createdAt: 'asc' },
      }),
    ]);
    return { runs, versions, testCases };
  }
}
