import { Injectable, BadRequestException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../rag/llm.service';
import type { UpdateVlmConfigDto } from './dto/update-vlm-config.dto';

export interface VlmConfigResponse {
  enabled: boolean;
  textThreshold: number;
  imageWidth: number;
  imageHeight: number;
  provider: string;
}

const DEFAULTS: VlmConfigResponse = {
  enabled: true,
  textThreshold: 80,
  imageWidth: 256,
  imageHeight: 256,
  provider: 'same',
};

@Injectable()
export class VlmService {
  private readonly logger = new Logger(VlmService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly llm: LlmService,
  ) {}

  async getConfig(teacherId: string): Promise<VlmConfigResponse> {
    const row = await this.prisma.vlmConfig.findUnique({ where: { teacherId } });
    if (!row) return { ...DEFAULTS };
    return {
      enabled: row.enabled,
      textThreshold: row.textThreshold,
      imageWidth: row.imageWidth,
      imageHeight: row.imageHeight,
      provider: row.provider,
    };
  }

  async getConfigForCourse(courseId: string): Promise<VlmConfigResponse> {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) return { ...DEFAULTS };
    return this.getConfig(course.teacherId);
  }

  async updateConfig(teacherId: string, dto: UpdateVlmConfigDto): Promise<VlmConfigResponse> {
    if (dto.textThreshold !== undefined && (dto.textThreshold < 0 || dto.textThreshold > 2000)) {
      throw new BadRequestException('textThreshold must be between 0 and 2000');
    }
    const validSizes = [128, 256, 512, 1024];
    if (dto.imageWidth !== undefined && !validSizes.includes(dto.imageWidth)) {
      throw new BadRequestException('imageWidth must be 128, 256, 512, or 1024');
    }
    if (dto.imageHeight !== undefined && !validSizes.includes(dto.imageHeight)) {
      throw new BadRequestException('imageHeight must be 128, 256, 512, or 1024');
    }
    if (dto.provider !== undefined && !['same', 'openai', 'gemini'].includes(dto.provider)) {
      throw new BadRequestException('provider must be "same", "openai", or "gemini"');
    }

    const existing = await this.prisma.vlmConfig.findUnique({ where: { teacherId } });
    if (existing) {
      await this.prisma.vlmConfig.update({
        where: { teacherId },
        data: {
          ...(dto.enabled !== undefined && { enabled: dto.enabled }),
          ...(dto.textThreshold !== undefined && { textThreshold: dto.textThreshold }),
          ...(dto.imageWidth !== undefined && { imageWidth: dto.imageWidth }),
          ...(dto.imageHeight !== undefined && { imageHeight: dto.imageHeight }),
          ...(dto.provider !== undefined && { provider: dto.provider }),
        },
      });
    } else {
      await this.prisma.vlmConfig.create({
        data: {
          teacherId,
          enabled: dto.enabled ?? DEFAULTS.enabled,
          textThreshold: dto.textThreshold ?? DEFAULTS.textThreshold,
          imageWidth: dto.imageWidth ?? DEFAULTS.imageWidth,
          imageHeight: dto.imageHeight ?? DEFAULTS.imageHeight,
          provider: dto.provider ?? DEFAULTS.provider,
        },
      });
    }
    return this.getConfig(teacherId);
  }

  async describePage(
    base64: string,
    courseId: string,
    userId: string,
  ): Promise<{ description: string }> {
    if (!base64 || base64.length < 100) {
      throw new BadRequestException('base64 image is required');
    }

    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!course) throw new BadRequestException('Course not found');

    const teacherId = course.teacherId;
    const config = await this.getConfig(teacherId);

    // Determine which provider to use for VLM
    let vlmProvider = config.provider;
    if (vlmProvider === 'same') {
      const teacherSettings = await this.prisma.user.findUnique({
        where: { id: teacherId },
        select: { llmProvider: true },
      });
      vlmProvider = teacherSettings?.llmProvider ?? 'openai';
    }

    const systemPrompt = `You are an educational content analyst. Describe the content of this slide in detail for educational purposes. Extract all visible text, describe diagrams, charts, tables, formulas, and key visual elements. Your description will be used to generate learning exercises, so be thorough and precise. If the slide contains formulas or calculations, write them out explicitly.`;

    const userMessage = `Please describe all the content in this slide image in detail. Include all visible text, equations, diagrams, charts, and any other educational content.`;

    try {
      const result = await this.llm.callLlmStructured(
        teacherId,
        {
          systemPrompt,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: userMessage },
                {
                  type: 'image_url',
                  image_url: { url: `data:image/png;base64,${base64}` },
                },
              ],
            },
          ],
          maxTokens: 1024,
          temperature: 0.2,
        },
        {
          feature: 'vlm_describe_page',
          courseId,
          triggeredByUserId: userId,
          modality: 'image',
        },
      );

      this.logger.log(
        `[VLM] describe-page done — provider:${result.provider} model:${result.model} ` +
          `promptTokens:${result.promptTokens} completionTokens:${result.completionTokens} ` +
          `userId:${userId} courseId:${courseId}`,
      );
      return { description: result.content.trim() };
    } catch (err) {
      this.logger.error(
        `VLM describe-page failed for course ${courseId}: ${(err as Error).message}`,
      );
      throw new BadRequestException('Failed to describe slide image. Please try again.');
    }
  }
}
