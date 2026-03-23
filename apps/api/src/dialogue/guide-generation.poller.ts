import { Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { EventBusService } from '../event-bus';
import { LlmService } from '../rag/llm.service';
import { PrismaService } from '../prisma';
import { DialogueGateway } from './dialogue.gateway';
import { EventTopics, GenerateSourceGuidePayloadSchema } from '@ats/shared';

@Injectable()
export class GuideGenerationPoller implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(GuideGenerationPoller.name);
  private intervalHandle: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly eventBus: EventBusService,
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
    private readonly gateway: DialogueGateway,
  ) {}

  onModuleInit(): void {
    this.logger.log('Starting generate_source_guide event poller (3s interval)');
    this.intervalHandle = setInterval(() => {
      this.poll().catch((err) => {
        this.logger.error('Polling error', err);
      });
    }, 3000);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  private async poll(): Promise<void> {
    await this.eventBus.pollAndProcess(EventTopics.GENERATE_SOURCE_GUIDE, async (event) => {
      const parsed = GenerateSourceGuidePayloadSchema.parse(event.payload);
      await this.generateGuide(parsed.documentId, parsed.studentId, parsed.courseId);
    });
  }

  private async generateGuide(
    documentId: string,
    studentId: string,
    courseId: string,
  ): Promise<void> {
    // Notify client that guide generation is starting
    this.gateway.emitProcessingUpdate(studentId, {
      documentId,
      status: 'GENERATING_GUIDE',
    });

    try {
      // Fetch chunks for this document
      const chunks = await this.prisma.studentRagChunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
        take: 30,
      });

      if (chunks.length === 0) {
        this.logger.warn(`No chunks found for document ${documentId}, skipping guide`);
        return;
      }

      // Assemble content (up to ~8000 chars)
      let content = '';
      for (const chunk of chunks) {
        if (content.length + chunk.content.length > 8000) break;
        content += chunk.content + '\n\n';
      }

      // Get course to find teacher credentials
      const course = await this.prisma.course.findUnique({
        where: { id: courseId },
      });
      if (!course) {
        this.logger.warn(`Course ${courseId} not found for guide generation`);
        return;
      }

      const systemPrompt =
        'You are a study guide generator. Analyze the following document content and produce a JSON object with:\n' +
        '- "summary": A 2-3 paragraph summary of the document\n' +
        '- "tableOfContents": An array of { "heading": string, "level": number (1-6), "pageRef": number|null }\n' +
        '- "suggestedQuestions": An array of 5-8 study questions about the material\n' +
        '- "keyTopics": An array of 5-10 key topics/concepts from the document\n' +
        'Return ONLY valid JSON.';

      const { content: llmOutput } = await this.llmService.callLlmForUser(
        course.teacherId,
        systemPrompt,
        `Document content:\n\n${content}`,
        {
          feature: 'source_guide_generation',
          courseId,
          triggeredByUserId: studentId,
        },
      );

      // Parse LLM JSON output
      const guideData = this.parseGuideJson(llmOutput);

      // Upsert the guide
      const toc = (guideData.tableOfContents || []) as object[];
      const questions = (guideData.suggestedQuestions || []) as string[];
      const topics = (guideData.keyTopics || []) as string[];

      await this.prisma.studentSourceGuide.upsert({
        where: { documentId },
        create: {
          documentId,
          summary: guideData.summary || 'Summary not available',
          tableOfContents: toc,
          suggestedQuestions: questions,
          keyTopics: topics,
        },
        update: {
          summary: guideData.summary || 'Summary not available',
          tableOfContents: toc,
          suggestedQuestions: questions,
          keyTopics: topics,
          updatedAt: new Date(),
        },
      });

      // Notify client that guide is ready
      this.gateway.emitProcessingUpdate(studentId, {
        documentId,
        status: 'GUIDE_READY',
      });

      this.logger.log(`Generated source guide for document ${documentId}`);
    } catch (err) {
      this.logger.error(`Failed to generate guide for document ${documentId}`, err);
      this.gateway.emitProcessingUpdate(studentId, {
        documentId,
        status: 'GUIDE_FAILED',
      });
    }
  }

  private parseGuideJson(raw: string): {
    summary?: string;
    tableOfContents?: unknown[];
    suggestedQuestions?: string[];
    keyTopics?: string[];
  } {
    try {
      return JSON.parse(raw);
    } catch {
      const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        try {
          return JSON.parse(fenceMatch[1]!.trim());
        } catch {
          // Fall through
        }
      }
      const braceMatch = raw.match(/\{[\s\S]*\}/);
      if (braceMatch) {
        try {
          return JSON.parse(braceMatch[0]);
        } catch {
          // Fall through
        }
      }
      return {};
    }
  }
}
