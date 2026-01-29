import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma';
import type { CreateQuestion, UpdateQuestion } from '@ats/shared';

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(teacherId: string, dto: CreateQuestion) {
    // Verify topic's course ownership
    const topic = await this.prisma.topic.findUnique({
      where: { id: dto.topicId },
      include: { course: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${dto.topicId} not found`);
    }

    if (topic.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only add questions to your own courses');
    }

    const question = await this.prisma.question.create({
      data: {
        topicId: dto.topicId,
        prompt: dto.prompt,
        type: dto.type,
        maxScore: dto.maxScore,
        rubricJson:
          dto.rubricJson === null
            ? Prisma.DbNull
            : (dto.rubricJson as Prisma.InputJsonValue | undefined),
      },
    });

    // Link KCs if provided
    if (dto.kcIds && dto.kcIds.length > 0) {
      await this.prisma.questionKc.createMany({
        data: dto.kcIds.map((kcId) => ({
          questionId: question.id,
          kcId,
        })),
      });
    }

    return question;
  }

  async findByTopic(topicId: string) {
    return this.prisma.question.findMany({
      where: { topicId },
      include: {
        questionKcs: {
          include: { kc: { select: { id: true, code: true, label: true } } },
        },
      },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(id: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        topic: {
          include: {
            course: {
              select: { id: true, title: true, teacherId: true },
            },
          },
        },
        questionKcs: {
          include: { kc: { select: { id: true, code: true, label: true } } },
        },
      },
    });

    if (!question) {
      throw new NotFoundException(`Question ${id} not found`);
    }

    return question;
  }

  async update(id: string, teacherId: string, dto: UpdateQuestion) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        topic: { include: { course: true } },
      },
    });

    if (!question) {
      throw new NotFoundException(`Question ${id} not found`);
    }

    if (question.topic.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update questions in your own courses');
    }

    const updateData: Prisma.QuestionUpdateInput = {
      prompt: dto.prompt,
      type: dto.type,
      maxScore: dto.maxScore,
      version: { increment: 1 },
    };

    if (dto.rubricJson !== undefined) {
      updateData.rubricJson =
        dto.rubricJson === null ? Prisma.DbNull : (dto.rubricJson as Prisma.InputJsonValue);
    }

    const updated = await this.prisma.question.update({
      where: { id },
      data: updateData,
    });

    // Update KC links if provided
    if (dto.kcIds !== undefined) {
      // Remove existing links and re-create
      await this.prisma.questionKc.deleteMany({ where: { questionId: id } });
      if (dto.kcIds && dto.kcIds.length > 0) {
        await this.prisma.questionKc.createMany({
          data: dto.kcIds.map((kcId) => ({
            questionId: id,
            kcId,
          })),
        });
      }
    }

    return updated;
  }

  async remove(id: string, teacherId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        topic: { include: { course: true } },
      },
    });

    if (!question) {
      throw new NotFoundException(`Question ${id} not found`);
    }

    if (question.topic.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only delete questions in your own courses');
    }

    await this.prisma.question.delete({ where: { id } });

    return { deleted: true };
  }
}
