import { Injectable, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { CONSTRUCTS } from '../detection/constructs';
import { DEFAULT_PROMPTS } from '../detection/default-prompts';

@Injectable()
export class PromptsService {
  constructor(private readonly prisma: PrismaService) {}

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
}
