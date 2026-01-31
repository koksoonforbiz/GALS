import {
  Injectable,
  Logger,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MathNormalizerService } from './math-normalizer.service';
import {
  buildEvaluationSystemPrompt,
  buildEvaluationUserPrompt,
  type EvalConfig,
} from './evaluation-prompts';

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

// ─── Interfaces ─────────────────────────────────────────

export interface StartEvaluationInput {
  courseId: string;
  userId: string;
  pageIds: string[];
  config: EvalConfig;
}

export interface ApplyFixesInput {
  courseId: string;
  userId: string;
  resultId: string;
  fixTypes: ('math' | 'formatting')[];
}

interface LlmEvalOutput {
  scores: Record<string, number>;
  overall: number;
  issues: Array<{
    category: string;
    severity: string;
    location: string;
    message: string;
    suggestedFix: string | null;
  }>;
  strengths: string[];
  summary: string;
}

@Injectable()
export class EvaluationService {
  private readonly logger = new Logger(EvaluationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly mathNormalizer: MathNormalizerService,
  ) {}

  // ─── Start Evaluation Run ─────────────────────────────

  async startEvaluation(input: StartEvaluationInput) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({
      where: { id: input.courseId },
      select: { id: true, title: true, description: true, teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== input.userId) {
      throw new ForbiddenException('Only the course teacher can evaluate content');
    }

    // Create evaluation run
    const run = await this.prisma.evaluationRun.create({
      data: {
        courseId: input.courseId,
        userId: input.userId,
        status: 'RUNNING',
        config: input.config as Prisma.InputJsonValue,
        startedAt: new Date(),
      },
    });

    // Process pages (don't await — run in background-ish via setImmediate)
    this.processEvaluation(
      run.id,
      input.courseId,
      input.userId,
      input.pageIds,
      input.config,
      course.title,
    ).catch((err: unknown) => {
      this.logger.error(`Evaluation run ${run.id} failed: ${errMsg(err)}`);
    });

    return { runId: run.id, status: 'RUNNING' };
  }

  // ─── Get Evaluation Run + Results ─────────────────────

  async getRun(runId: string, userId: string) {
    const run = await this.prisma.evaluationRun.findUnique({
      where: { id: runId },
      include: { results: { orderBy: { createdAt: 'asc' } } },
    });
    if (!run) throw new NotFoundException('Evaluation run not found');
    if (run.userId !== userId) throw new ForbiddenException('Not your evaluation run');
    return run;
  }

  async listRuns(courseId: string, userId: string) {
    // Verify ownership
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== userId) throw new ForbiddenException('Not your course');

    return this.prisma.evaluationRun.findMany({
      where: { courseId },
      orderBy: { createdAt: 'desc' },
      include: {
        results: {
          select: { id: true, itemId: true, itemTitle: true, scores: true, fixesApplied: true },
        },
      },
    });
  }

  // ─── Apply Fixes ──────────────────────────────────────

  async applyFixes(input: ApplyFixesInput) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({
      where: { id: input.courseId },
      select: { teacherId: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== input.userId) throw new ForbiddenException('Not your course');

    const result = await this.prisma.pageEvalResult.findUnique({
      where: { id: input.resultId },
    });
    if (!result) throw new NotFoundException('Evaluation result not found');

    // Get current page content
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: result.itemId },
    });
    if (!item?.contentMdx) throw new BadRequestException('Page has no content');

    let content = item.contentMdx;
    let totalFixed = 0;

    // Apply math fixes (deterministic)
    if (input.fixTypes.includes('math')) {
      const { fixed, appliedCount } = this.mathNormalizer.applyFixes(content);
      content = fixed;
      totalFixed += appliedCount;
    }

    if (totalFixed === 0) {
      return { applied: false, message: 'No auto-fixable issues found' };
    }

    // Save updated content
    await this.prisma.moduleItem.update({
      where: { id: result.itemId },
      data: { contentMdx: content },
    });

    // Create version snapshot
    await this.createVersionSnapshot(result.itemId, content, 'eval-fix', input.userId);

    // Mark result as fixed
    await this.prisma.pageEvalResult.update({
      where: { id: input.resultId },
      data: { fixesApplied: true },
    });

    return { applied: true, fixCount: totalFixed };
  }

  // ─── Get Course Page Tree ─────────────────────────────

  async getCoursePageTree(courseId: string, userId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true, title: true },
    });
    if (!course) throw new NotFoundException('Course not found');
    if (course.teacherId !== userId) throw new ForbiddenException('Not your course');

    const modules = await this.prisma.courseModule.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      select: {
        id: true,
        title: true,
        items: {
          where: { type: 'PAGE' },
          orderBy: { orderIndex: 'asc' },
          select: { id: true, title: true, contentMdx: true },
        },
      },
    });

    return {
      courseTitle: course.title,
      modules: modules.map((m) => ({
        id: m.id,
        title: m.title,
        pages: m.items.map((item) => ({
          id: item.id,
          title: item.title,
          hasContent: !!item.contentMdx,
        })),
      })),
    };
  }

  // ─── Private: Process Evaluation ──────────────────────

  private async processEvaluation(
    runId: string,
    courseId: string,
    userId: string,
    pageIds: string[],
    config: EvalConfig,
    courseTitle: string,
  ) {
    try {
      // Get LLM credentials
      const credentials = await this.getLlmCredentials(userId);

      // Get module info for each page
      const pages = await this.prisma.moduleItem.findMany({
        where: { id: { in: pageIds }, type: 'PAGE' },
        include: { module: { select: { title: true } } },
      });

      const aggregateScores: Record<string, number[]> = {};
      config.rubrics.forEach((r) => (aggregateScores[r] = []));

      // Process pages sequentially (to avoid rate-limiting)
      for (const page of pages) {
        try {
          const evalResult = await this.evaluateSinglePage(page, config, credentials, courseTitle);

          // Store result
          await this.prisma.pageEvalResult.create({
            data: {
              runId,
              itemId: page.id,
              itemTitle: page.title,
              scores: evalResult.scores as Prisma.InputJsonValue,
              issues: evalResult.issues as Prisma.InputJsonValue,
              mathIssues: evalResult.mathIssues as Prisma.InputJsonValue,
            },
          });

          // Accumulate scores
          for (const rubric of config.rubrics) {
            const score = (evalResult.scores as Record<string, number>)[rubric];
            if (score !== undefined) aggregateScores[rubric]!.push(score);
          }
        } catch (err: unknown) {
          this.logger.error(`Evaluation failed for page ${page.id}: ${errMsg(err)}`);
          // Store error result
          await this.prisma.pageEvalResult.create({
            data: {
              runId,
              itemId: page.id,
              itemTitle: page.title,
              scores: { error: true, message: errMsg(err) },
              issues: [],
            },
          });
        }
      }

      // Compute summary
      const summary: Record<string, number> = {};
      for (const [rubric, scores] of Object.entries(aggregateScores)) {
        summary[rubric] =
          scores.length > 0 ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 0;
      }
      const allScores = Object.values(summary);
      summary.overall =
        allScores.length > 0
          ? Math.round(allScores.reduce((a, b) => a + b, 0) / allScores.length)
          : 0;

      await this.prisma.evaluationRun.update({
        where: { id: runId },
        data: {
          status: 'COMPLETED',
          summary: summary as Prisma.InputJsonValue,
          completedAt: new Date(),
        },
      });
    } catch (err: unknown) {
      await this.prisma.evaluationRun.update({
        where: { id: runId },
        data: {
          status: 'FAILED',
          errorMessage: errMsg(err),
          completedAt: new Date(),
        },
      });
      throw err;
    }
  }

  private async evaluateSinglePage(
    page: { id: string; title: string; contentMdx: string | null; module: { title: string } },
    config: EvalConfig,
    credentials: { apiKey: string; model: string } | null,
    courseTitle: string,
  ) {
    const contentJson = page.contentMdx || '{"version":2,"blocks":[]}';

    // 1. Deterministic math analysis
    const mathIssues = this.mathNormalizer.analyze(contentJson);

    // 2. LLM evaluation (if credentials available and rubrics require it)
    let llmResult: LlmEvalOutput | null = null;
    const needsLlm = config.rubrics.some((r) =>
      ['pedagogy', 'rigor', 'formatting', 'equations'].includes(r),
    );

    if (needsLlm && credentials) {
      const systemPrompt = buildEvaluationSystemPrompt(config);
      const userPrompt = buildEvaluationUserPrompt(
        page.title,
        contentJson,
        courseTitle,
        page.module.title,
      );

      const response = await this.callOpenAiApi(
        systemPrompt,
        userPrompt,
        credentials.apiKey,
        credentials.model,
      );

      try {
        llmResult = this.parseLlmEvalOutput(response.content);
      } catch (err: unknown) {
        this.logger.warn(`Failed to parse LLM eval output for page ${page.id}: ${errMsg(err)}`);
      }
    }

    // 3. Merge results
    const scores: Record<string, number> = {};
    const issues: Array<Record<string, unknown>> = [];

    if (llmResult) {
      Object.assign(scores, llmResult.scores);
      scores.overall = llmResult.overall;
      issues.push(...llmResult.issues);
    }

    // Add math issues to the equations score
    if (mathIssues.length > 0) {
      const mathErrors = mathIssues.filter((i) => i.severity === 'error').length;
      const mathWarnings = mathIssues.filter((i) => i.severity === 'warning').length;
      // Penalize equations score for math issues
      if (scores.equations !== undefined) {
        scores.equations = Math.max(0, scores.equations - mathErrors * 10 - mathWarnings * 3);
      }
      // Add math issues to issues list
      for (const mi of mathIssues) {
        issues.push({
          category: 'equations',
          severity: mi.severity,
          location: mi.location,
          message: mi.message,
          suggestedFix: mi.autoFixable ? mi.suggestedFix : null,
          source: 'math_normalizer',
          autoFixable: mi.autoFixable,
        });
      }
    }

    // Recalculate overall
    const scoreValues = config.rubrics
      .map((r) => scores[r])
      .filter((v): v is number => v !== undefined);
    if (scoreValues.length > 0) {
      scores.overall = Math.round(scoreValues.reduce((a, b) => a + b, 0) / scoreValues.length);
    }

    return {
      scores,
      issues,
      mathIssues: mathIssues.length > 0 ? mathIssues : null,
      strengths: llmResult?.strengths || [],
      summary: llmResult?.summary || '',
    };
  }

  // ─── Private: LLM Helpers ─────────────────────────────

  private async getLlmCredentials(
    userId: string,
  ): Promise<{ apiKey: string; model: string } | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { llmProvider: true, llmModel: true, encryptedApiKey: true },
    });
    if (!user?.encryptedApiKey) return null;
    try {
      const apiKey = this.decryptApiKey(user.encryptedApiKey);
      return { apiKey, model: user.llmModel || 'gpt-4o-mini' };
    } catch {
      return null;
    }
  }

  private decryptApiKey(encrypted: string): string {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const crypto = require('crypto');
    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
    const key = crypto.scryptSync(secret, 'llm-key-salt', 32);
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0]!, 'hex');
    const authTag = Buffer.from(parts[1]!, 'hex');
    const encryptedBuf = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encryptedBuf) + decipher.final('utf8');
  }

  private async callOpenAiApi(
    systemPrompt: string,
    userPrompt: string,
    apiKey: string,
    model: string,
  ): Promise<{ content: string; promptTokens: number; completionTokens: number }> {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 4096,
        temperature: 0.2,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`OpenAI API error: ${response.status} ${errorText}`);
      throw new BadRequestException(`LLM API error (${response.status}). Check your API key.`);
    }

    const data = (await response.json()) as {
      choices?: Array<{ message?: { content?: string } }>;
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    return {
      content: data.choices?.[0]?.message?.content || '',
      promptTokens: data.usage?.prompt_tokens || 0,
      completionTokens: data.usage?.completion_tokens || 0,
    };
  }

  private parseLlmEvalOutput(raw: string): LlmEvalOutput {
    let jsonStr = raw.trim();
    const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenceMatch) jsonStr = fenceMatch[1]!.trim();

    const parsed = JSON.parse(jsonStr);
    return {
      scores: parsed.scores || {},
      overall: parsed.overall || 0,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
      summary: parsed.summary || '',
    };
  }

  private async createVersionSnapshot(
    itemId: string,
    contentJson: string,
    source: string,
    authorId: string,
  ) {
    const latest = await this.prisma.pageContentVersion.findFirst({
      where: { itemId },
      orderBy: { version: 'desc' },
      select: { version: true },
    });
    const nextVersion = (latest?.version ?? 0) + 1;

    await this.prisma.pageContentVersion.create({
      data: {
        itemId,
        version: nextVersion,
        contentJson,
        source,
        authorId,
      },
    });
  }
}
