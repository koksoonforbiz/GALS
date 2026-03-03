import { Injectable, Logger, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import { LlmService } from '../rag/llm.service';
import type { StudioOutputType } from '@prisma/client';
import type { GenerateStudioDto } from './dto';

interface StudioPromptConfig {
  systemPrompt: string;
  userPromptTemplate: string;
  defaultTitle: string;
}

const STUDIO_PROMPTS: Record<string, StudioPromptConfig> = {
  BRIEFING_DOC: {
    systemPrompt:
      'You are a study-aid generator. Create a concise briefing document with clear sections. ' +
      'Return ONLY valid JSON matching: { "sections": [{ "heading": string, "body": string }] }',
    userPromptTemplate:
      'Create a briefing document from the following study material:\n\n{content}\n\n{hint}',
    defaultTitle: 'Briefing Document',
  },
  FLASHCARD_SET: {
    systemPrompt:
      'You are a flashcard generator. Create effective study flashcards from the material. ' +
      'Return ONLY valid JSON matching: { "cards": [{ "front": string, "back": string, "kcHint": string? }] }',
    userPromptTemplate:
      'Create flashcards from the following study material:\n\n{content}\n\n{hint}',
    defaultTitle: 'Flashcard Set',
  },
  TABLE_COMPARISON: {
    systemPrompt:
      'You are a comparison table generator. Create a structured comparison table. ' +
      'Return ONLY valid JSON matching: { "headers": string[], "rows": string[][], "caption": string? }',
    userPromptTemplate:
      'Create a comparison table from the following study material:\n\n{content}\n\n{hint}',
    defaultTitle: 'Comparison Table',
  },
  MIND_MAP: {
    systemPrompt:
      'You are a mind map generator. Create a hierarchical mind map structure. ' +
      'Return ONLY valid JSON matching: { "root": string, "nodes": [{ "id": string, "label": string, "parentId": string|null, "level": number }] }',
    userPromptTemplate:
      'Create a mind map from the following study material:\n\n{content}\n\n{hint}',
    defaultTitle: 'Mind Map',
  },
  TIMELINE: {
    systemPrompt:
      'You are a timeline generator. Create a chronological or sequential timeline. ' +
      'Return ONLY valid JSON matching: { "sections": [{ "heading": string, "body": string }] }',
    userPromptTemplate:
      'Create a timeline from the following study material:\n\n{content}\n\n{hint}',
    defaultTitle: 'Timeline',
  },
  FAQ: {
    systemPrompt:
      'You are an FAQ generator. Create frequently asked questions with clear answers. ' +
      'Return ONLY valid JSON matching: { "items": [{ "question": string, "answer": string }] }',
    userPromptTemplate: 'Create an FAQ from the following study material:\n\n{content}\n\n{hint}',
    defaultTitle: 'FAQ',
  },
};

@Injectable()
export class StudioService {
  private readonly logger = new Logger(StudioService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  async generate(studentId: string, courseId: string, dto: GenerateStudioDto) {
    // Verify session ownership if sessionId provided
    let sessionId = dto.sessionId;
    if (sessionId) {
      const session = await this.prisma.dialogueSession.findUnique({
        where: { id: sessionId },
      });
      if (!session) throw new NotFoundException('Session not found');
      if (session.studentId !== studentId) throw new ForbiddenException('Not your session');
    } else {
      // Find or create a default session for this student+course
      const enrollment = await this.prisma.enrollment.findUnique({
        where: { studentId_courseId: { studentId, courseId } },
      });
      if (!enrollment) throw new ForbiddenException('Not enrolled');

      const session = await this.prisma.dialogueSession.create({
        data: {
          enrollmentId: enrollment.id,
          studentId,
          courseId,
          title: `Studio: ${STUDIO_PROMPTS[dto.type]?.defaultTitle || dto.type}`,
          activeSourceIds: dto.sourceIds,
        },
      });
      sessionId = session.id;
    }

    // Get course for teacher credentials
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException('Course not found');

    // Assemble content from student chunks
    const content = await this.assembleContent(studentId, courseId, dto.sourceIds, dto.promptHint);

    const promptConfig = STUDIO_PROMPTS[dto.type];
    if (!promptConfig) throw new NotFoundException(`Unknown studio type: ${dto.type}`);

    const userPrompt = promptConfig.userPromptTemplate
      .replace('{content}', content)
      .replace('{hint}', dto.promptHint ? `Focus: ${dto.promptHint}` : '');

    const { content: llmOutput } = await this.llmService.callLlmForUser(
      course.teacherId,
      promptConfig.systemPrompt,
      userPrompt,
      {
        feature: `studio_${dto.type.toLowerCase()}`,
        courseId,
        triggeredByUserId: studentId,
      },
    );

    // Parse JSON from LLM output
    const parsedContent = this.parseStudioJson(llmOutput);

    const output = await this.prisma.studioOutput.create({
      data: {
        sessionId: sessionId!,
        studentId,
        type: dto.type as StudioOutputType,
        title: promptConfig.defaultTitle,
        content: parsedContent as object,
        sourceIds: dto.sourceIds,
      },
    });

    return output;
  }

  async listOutputs(sessionId: string, studentId: string) {
    const session = await this.prisma.dialogueSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) throw new NotFoundException('Session not found');
    if (session.studentId !== studentId) throw new ForbiddenException('Not your session');

    return this.prisma.studioOutput.findMany({
      where: { sessionId },
      orderBy: { createdAt: 'desc' },
    });
  }

  async deleteOutput(outputId: string, studentId: string) {
    const output = await this.prisma.studioOutput.findUnique({
      where: { id: outputId },
    });
    if (!output) throw new NotFoundException('Studio output not found');
    if (output.studentId !== studentId) throw new ForbiddenException('Not your output');

    await this.prisma.studioOutput.delete({ where: { id: outputId } });
    return { deleted: true };
  }

  // ─── Helpers ──────────────────────────────────────────────

  private async assembleContent(
    studentId: string,
    courseId: string,
    sourceIds: string[],
    promptHint?: string,
  ): Promise<string> {
    const chunks = await this.prisma.studentRagChunk.findMany({
      where: {
        studentId,
        courseId,
        documentId: { in: sourceIds },
      },
      include: {
        document: { select: { originalName: true } },
      },
      orderBy: { chunkIndex: 'asc' },
    });

    if (chunks.length === 0) return '(No source content available)';

    // Sort by term relevance if promptHint provided
    let sorted = chunks;
    if (promptHint) {
      sorted = [...chunks].sort((a, b) => {
        return (
          this.termRelevance(b.content, promptHint) - this.termRelevance(a.content, promptHint)
        );
      });
    }

    // Assemble up to ~12,000 chars
    const MAX_CHARS = 12000;
    let assembled = '';
    for (const chunk of sorted) {
      const line = `[${chunk.document.originalName}] ${chunk.content}\n\n`;
      if (assembled.length + line.length > MAX_CHARS) break;
      assembled += line;
    }

    return assembled || '(No source content available)';
  }

  private termRelevance(text: string, hint: string): number {
    const terms = hint
      .toLowerCase()
      .split(/\s+/)
      .filter((t) => t.length > 2);
    const lower = text.toLowerCase();
    let score = 0;
    for (const term of terms) {
      const matches = lower.match(new RegExp(term, 'g'));
      if (matches) score += matches.length;
    }
    return score;
  }

  private parseStudioJson(raw: string): unknown {
    // Try direct parse
    try {
      return JSON.parse(raw);
    } catch {
      // Try extracting from markdown code fence
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try {
          return JSON.parse(fenceMatch[1]!.trim());
        } catch {
          // Fall through
        }
      }

      // Try extracting first { ... } block
      const braceMatch = raw.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          return JSON.parse(braceMatch[0]);
        } catch {
          // Fall through
        }
      }

      this.logger.warn('Failed to parse studio JSON output, returning raw');
      return { raw };
    }
  }
}
