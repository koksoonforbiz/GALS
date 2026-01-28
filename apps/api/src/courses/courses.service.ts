import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import type { CreateCourse, UpdateCourse, UserRole } from '@ats/shared';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(teacherId: string, dto: CreateCourse) {
    return this.prisma.course.create({
      data: {
        ...dto,
        teacherId,
      },
      include: {
        teacher: {
          select: { id: true, name: true, email: true },
        },
      },
    });
  }

  async findAll(userId: string, role: UserRole) {
    if (role === 'admin') {
      return this.prisma.course.findMany({
        include: {
          teacher: { select: { id: true, name: true, email: true } },
          _count: { select: { topics: true, enrollments: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    if (role === 'teacher') {
      return this.prisma.course.findMany({
        where: { teacherId: userId },
        include: {
          teacher: { select: { id: true, name: true, email: true } },
          _count: { select: { topics: true, enrollments: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    // Student: courses they're enrolled in
    return this.prisma.course.findMany({
      where: {
        enrollments: { some: { studentId: userId } },
      },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        _count: { select: { topics: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOne(id: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        topics: {
          orderBy: { orderIndex: 'asc' },
          include: {
            _count: { select: { questions: true } },
          },
        },
        _count: { select: { enrollments: true } },
      },
    });

    if (!course) {
      throw new NotFoundException(`Course ${id} not found`);
    }

    return course;
  }

  async update(id: string, teacherId: string, dto: UpdateCourse) {
    const course = await this.prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      throw new NotFoundException(`Course ${id} not found`);
    }

    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update your own courses');
    }

    return this.prisma.course.update({
      where: { id },
      data: dto,
      include: {
        teacher: { select: { id: true, name: true, email: true } },
      },
    });
  }

  async remove(id: string, teacherId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id },
    });

    if (!course) {
      throw new NotFoundException(`Course ${id} not found`);
    }

    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only delete your own courses');
    }

    await this.prisma.course.delete({ where: { id } });

    return { deleted: true };
  }
}
