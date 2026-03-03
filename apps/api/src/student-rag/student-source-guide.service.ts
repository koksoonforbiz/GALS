import { Injectable, Logger } from '@nestjs/common';
import { OnEvent } from '@nestjs/event-emitter';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../rag/llm.service';
import { DialogueCourseSettingsSchema } from '@ats/shared';
import { Prisma } from '@prisma/client';

interface GuideJson {
  summary: string;
  tableOfContents: Array<{ heading: string; level: number; pageRef: number | null }>;
  suggestedQuestions: string[];
  keyTopics: string[];
}

const MAX_GUIDE_CONTENT_CHARS = 8000;
const MAX_CHUNKS_FOR_GUIDE = 30;

@Injectable()
export class StudentSourceGuideService {
  private readonly logger = new Logger(StudentSourceGuideService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  @OnEvent('student-document.processed')
  async handleDocumentProcessed(payload: { documentId: string }) {
    // Check if auto guide generation is enabled
    const doc = await this.prisma.studentSourceDocument.findUnique({
      where: { id: payload.documentId },
      include: {
        course: { select: { dblSettings: true, teacherId: true } },
      },
    });

    if (!doc) return;

    const settings = this.parseDblSettings(doc.course.dblSettings);
    if (settings.autoGenerateGuide) {
      await this.generateGuide(payload.documentId);
    }
  }

  async generateGuide(documentId: string) {
    const doc = await this.prisma.studentSourceDocument.findUnique({
      where: { id: documentId },
      include: {
        course: {
          select: { teacherId: true, dblSettings: true },
        },
      },
    });

    if (!doc) {
      this.logger.error(`Document ${documentId} not found for guide generation`);
      return null;
    }

    try {
      // 1. Fetch first N chunks of the document
      const chunks = await this.prisma.studentRagChunk.findMany({
        where: { documentId },
        orderBy: { chunkIndex: 'asc' },
        take: MAX_CHUNKS_FOR_GUIDE,
        select: { content: true },
      });

      if (chunks.length === 0) {
        this.logger.warn(`No chunks found for document ${documentId}`);
        return null;
      }

      // 2. Concatenate content (max chars)
      let content = '';
      for (const chunk of chunks) {
        if (content.length + chunk.content.length > MAX_GUIDE_CONTENT_CHARS) {
          content += chunk.content.slice(0, MAX_GUIDE_CONTENT_CHARS - content.length);
          break;
        }
        content += chunk.content + '\n\n';
      }

      // 3. Build prompt
      const systemPrompt =
        'You are an educational assistant. Analyze this document and return ONLY valid JSON.';

      const userPrompt = `Document: """${content}"""

Return JSON with this exact structure:
{
  "summary": "2-3 paragraph overview of the document",
  "tableOfContents": [
    { "heading": "string", "level": 1, "pageRef": null }
  ],
  "suggestedQuestions": ["5-8 questions a student might ask about this material"],
  "keyTopics": ["6-10 key concepts or topics covered"]
}`;

      // 4. Call LLM
      const result = await this.llmService.callLlmForUser(
        doc.course.teacherId,
        systemPrompt,
        userPrompt,
        { feature: 'source_guide_generation', courseId: doc.courseId },
      );

      // 5. Parse JSON response
      const guideData = this.parseGuideJson(result.content);

      // 6. Upsert StudentSourceGuide
      const guide = await this.prisma.studentSourceGuide.upsert({
        where: { documentId },
        create: {
          documentId,
          summary: guideData.summary,
          tableOfContents: guideData.tableOfContents as unknown as Prisma.InputJsonValue,
          suggestedQuestions: guideData.suggestedQuestions as unknown as Prisma.InputJsonValue,
          keyTopics: guideData.keyTopics as unknown as Prisma.InputJsonValue,
        },
        update: {
          summary: guideData.summary,
          tableOfContents: guideData.tableOfContents as unknown as Prisma.InputJsonValue,
          suggestedQuestions: guideData.suggestedQuestions as unknown as Prisma.InputJsonValue,
          keyTopics: guideData.keyTopics as unknown as Prisma.InputJsonValue,
          generatedAt: new Date(),
        },
      });

      this.logger.log(`Guide generated for document ${documentId}`);
      return guide;
    } catch (error) {
      this.logger.error(`Guide generation failed for document ${documentId}`, error);
      return null;
    }
  }

  private parseGuideJson(content: string): GuideJson {
    // Try to extract JSON from the response
    // The LLM might wrap it in markdown code blocks
    let jsonStr = content;

    const jsonBlockMatch = content.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonBlockMatch) {
      jsonStr = jsonBlockMatch[1]!;
    }

    try {
      const parsed = JSON.parse(jsonStr.trim()) as GuideJson;

      return {
        summary: parsed.summary || 'No summary available.',
        tableOfContents: Array.isArray(parsed.tableOfContents) ? parsed.tableOfContents : [],
        suggestedQuestions: Array.isArray(parsed.suggestedQuestions)
          ? parsed.suggestedQuestions
          : [],
        keyTopics: Array.isArray(parsed.keyTopics) ? parsed.keyTopics : [],
      };
    } catch {
      // Fallback: use the content as a summary
      return {
        summary: content.slice(0, 1000),
        tableOfContents: [],
        suggestedQuestions: [],
        keyTopics: [],
      };
    }
  }

  private parseDblSettings(raw: unknown) {
    try {
      return DialogueCourseSettingsSchema.parse(raw || {});
    } catch {
      return DialogueCourseSettingsSchema.parse({});
    }
  }
}
