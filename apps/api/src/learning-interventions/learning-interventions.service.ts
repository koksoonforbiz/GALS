import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LlmService } from '../rag/llm.service';
import type { InterventionType, Prisma } from '@prisma/client';
import type { CreateSavedReviewDto, UpdateSavedReviewDto } from './dto';

@Injectable()
export class LearningInterventionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly llmService: LlmService,
  ) {}

  // ─── Saved Reviews CRUD ──────────────────────────────────

  async createSavedReview(userId: string, dto: CreateSavedReviewDto) {
    // Verify the intervention belongs to this user
    const intervention = await this.prisma.learningIntervention.findUnique({
      where: { id: dto.interventionId },
    });

    if (!intervention) {
      throw new NotFoundException(`Intervention ${dto.interventionId} not found`);
    }

    if (intervention.userId !== userId) {
      throw new ForbiddenException('Cannot save a review for another user');
    }

    return this.prisma.savedInterventionReview.create({
      data: {
        userId,
        interventionId: dto.interventionId,
        interventionType: dto.interventionType,
        courseId: dto.courseId,
        contentId: dto.contentId || null,
        pageType: dto.pageType || null,
        title: dto.title,
        selectedText: dto.selectedText,
        savedData: dto.savedData as Prisma.InputJsonValue,
        notes: dto.notes || null,
      },
    });
  }

  async findAllSavedReviews(
    userId: string,
    filters: {
      interventionType?: InterventionType;
      courseId?: string;
      page?: number;
      limit?: number;
    },
  ) {
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const skip = (page - 1) * limit;

    const where: Prisma.SavedInterventionReviewWhereInput = { userId };

    if (filters.interventionType) {
      where.interventionType = filters.interventionType;
    }

    if (filters.courseId) {
      where.courseId = filters.courseId;
    }

    const [items, total] = await Promise.all([
      this.prisma.savedInterventionReview.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          interventionId: true,
          interventionType: true,
          courseId: true,
          contentId: true,
          pageType: true,
          title: true,
          selectedText: true,
          notes: true,
          createdAt: true,
          updatedAt: true,
          // Don't include savedData in list view for performance
        },
      }),
      this.prisma.savedInterventionReview.count({ where }),
    ]);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  async findOneSavedReview(userId: string, id: string) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot access another user's review");
    }

    return review;
  }

  async updateSavedReview(userId: string, id: string, dto: UpdateSavedReviewDto) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot update another user's review");
    }

    const data: Prisma.SavedInterventionReviewUpdateInput = {};
    if (dto.notes !== undefined) data.notes = dto.notes;
    if (dto.title !== undefined) data.title = dto.title;

    return this.prisma.savedInterventionReview.update({
      where: { id },
      data,
    });
  }

  async deleteSavedReview(userId: string, id: string) {
    const review = await this.prisma.savedInterventionReview.findUnique({
      where: { id },
    });

    if (!review) {
      throw new NotFoundException(`Saved review ${id} not found`);
    }

    if (review.userId !== userId) {
      throw new ForbiddenException("Cannot delete another user's review");
    }

    await this.prisma.savedInterventionReview.delete({ where: { id } });

    return { deleted: true };
  }
}
