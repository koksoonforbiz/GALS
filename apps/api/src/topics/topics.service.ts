import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import type { CreateTopic, UpdateTopic } from '@ats/shared';

@Injectable()
export class TopicsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(teacherId: string, dto: CreateTopic) {
    // Verify course ownership
    const course = await this.prisma.course.findUnique({
      where: { id: dto.courseId },
    });

    if (!course) {
      throw new NotFoundException(`Course ${dto.courseId} not found`);
    }

    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only add topics to your own courses');
    }

    return this.prisma.topic.create({
      data: dto,
      include: {
        _count: { select: { questions: true } },
      },
    });
  }

  async findByCourse(courseId: string) {
    return this.prisma.topic.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      include: {
        _count: { select: { questions: true } },
      },
    });
  }

  async findOne(id: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: {
        course: {
          select: { id: true, title: true, teacherId: true },
        },
        questions: {
          orderBy: { createdAt: 'asc' },
        },
      },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${id} not found`);
    }

    return topic;
  }

  async update(id: string, teacherId: string, dto: UpdateTopic) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: { course: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${id} not found`);
    }

    if (topic.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update topics in your own courses');
    }

    return this.prisma.topic.update({
      where: { id },
      data: dto,
      include: {
        _count: { select: { questions: true } },
      },
    });
  }

  async remove(id: string, teacherId: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { id },
      include: { course: true },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${id} not found`);
    }

    if (topic.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only delete topics in your own courses');
    }

    await this.prisma.topic.delete({ where: { id } });

    return { deleted: true };
  }
}
