import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { LlmService } from '../../rag/llm.service';
import { CONSTRUCTS } from '../detection/constructs';
import { DEFAULT_PROMPTS } from '../detection/default-prompts';

@Injectable()
export class PromptsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async getPromptsForCourse(courseId: string) {
    const result: Record<string, unknown> = {};

    for (const c of CONSTRUCTS) {
      const coursePrompt = await this.prisma.efConstructPrompt.findFirst({
        where: { courseId, constructKey: c.key },
        orderBy: { version: 'desc' },
      });

      const globalPrompt = await this.prisma.efConstructPrompt.findFirst({
        where: { courseId: null, constructKey: c.key },
        orderBy: { version: 'desc' },
      });

      const active = coursePrompt ?? globalPrompt;

      result[c.key] = {
        promptText: active?.promptText ?? DEFAULT_PROMPTS[c.key] ?? '',
        version: active?.version ?? 0,
        isDefault: !coursePrompt,
        lastEditedBy: coursePrompt?.updatedBy ?? null,
        lastEditedAt: coursePrompt?.updatedAt ?? null,
      };
    }

    return { prompts: result };
  }

  async updatePrompt(
    courseId: string,
    constructKey: string,
    promptText: string,
    updatedBy: string,
  ) {
    if (!promptText.includes('<<<INSERT_UTTERANCE>>>')) {
      throw new BadRequestException('Prompt must contain <<<INSERT_UTTERANCE>>> placeholder');
    }

    const construct = CONSTRUCTS.find((c) => c.key === constructKey);
    if (!construct) {
      throw new BadRequestException(`Unknown construct: ${constructKey}`);
    }

    if (
      construct.needsRetrieval &&
      !promptText.includes('<<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>')
    ) {
      throw new BadRequestException(
        'Engagement prompt must contain <<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>> placeholder',
      );
    }

    const maxVersion = await this.prisma.efConstructPrompt.findFirst({
      where: { courseId, constructKey },
      orderBy: { version: 'desc' },
      select: { version: true },
    });

    const newVersion = (maxVersion?.version ?? 0) + 1;

    await this.prisma.efConstructPrompt.create({
      data: {
        courseId,
        constructKey,
        promptText,
        version: newVersion,
        updatedBy,
      },
    });

    return { version: newVersion };
  }

  async resetPrompts(courseId: string, constructKey?: string) {
    const where: Record<string, unknown> = { courseId };
    if (constructKey) where.constructKey = constructKey;

    await this.prisma.efConstructPrompt.deleteMany({ where });
    return { reset: true };
  }

  /**
   * Dry-run a prompt template against a sample utterance using the teacher's
   * configured LLM. Returns the parsed JSON output (or the raw text + parse
   * error) so teachers can sanity-check edits before saving a new version.
   *
   * Mirrors the call shape used by detection.service.ts: jsonMode + 200 max
   * tokens + the same system prompt, so the dry-run reproduces production
   * behaviour as closely as possible.
   */
  async tryPrompt(args: {
    teacherId: string;
    constructKey: string;
    promptText: string;
    utterance: string;
    courseTopic?: string;
    courseId?: string;
  }) {
    const construct = CONSTRUCTS.find((c) => c.key === args.constructKey);
    if (!construct) {
      throw new BadRequestException(`Unknown construct: ${args.constructKey}`);
    }
    if (!args.promptText.includes('<<<INSERT_UTTERANCE>>>')) {
      throw new BadRequestException('Prompt must contain <<<INSERT_UTTERANCE>>> placeholder');
    }
    if (
      construct.needsRetrieval &&
      !args.promptText.includes('<<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>')
    ) {
      throw new BadRequestException(
        'Engagement prompt must contain <<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>> placeholder',
      );
    }

    let filled = args.promptText.replace('<<<INSERT_UTTERANCE>>>', args.utterance);
    if (construct.needsRetrieval) {
      filled = filled.replace(
        '<<<INSERT_COURSE_TOPIC_OR_CURRENT_PROBLEM>>>',
        args.courseTopic?.trim() || '(no course context provided)',
      );
    }

    const start = Date.now();
    try {
      const result = await this.llmService.callLlmForUser(
        args.teacherId,
        'You are a learning analytics classifier. Output only valid JSON.',
        filled,
        { feature: 'text_mining_dry_run', courseId: args.courseId },
        { jsonMode: true, maxTokens: 200 },
      );
      const latencyMs = Date.now() - start;

      // Try to parse — return both parsed and raw so the UI can show parse
      // errors clearly (the LLM occasionally responds with prose despite
      // jsonMode=true).
      try {
        const parsed = JSON.parse(result.content) as Record<string, unknown>;
        return {
          ok: true,
          parsed,
          raw: result.content,
          latencyMs,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
      } catch {
        return {
          ok: false,
          error: 'LLM response was not valid JSON',
          raw: result.content,
          latencyMs,
          promptTokens: result.promptTokens,
          completionTokens: result.completionTokens,
        };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return {
        ok: false,
        error: message,
        latencyMs: Date.now() - start,
      };
    }
  }
}
