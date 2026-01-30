import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import type { CreateCourse, UpdateCourse, UserRole } from '@ats/shared';

@Injectable()
export class CoursesService {
  constructor(private readonly prisma: PrismaService) {}

  private readonly listInclude = {
    teacher: { select: { id: true, name: true, email: true } },
    topics: {
      orderBy: { orderIndex: 'asc' as const },
      include: { _count: { select: { questions: true } } },
    },
    _count: { select: { topics: true, enrollments: true, modules: true } },
  };

  async create(teacherId: string, dto: CreateCourse) {
    return this.prisma.course.create({
      data: {
        ...dto,
        teacherId,
        status: 'DRAFT',
      },
      include: this.listInclude,
    });
  }

  async findAll(userId: string, role: UserRole) {
    if (role === 'admin') {
      return this.prisma.course.findMany({
        where: { archivedAt: null },
        include: this.listInclude,
        orderBy: { createdAt: 'desc' },
      });
    }

    if (role === 'teacher') {
      return this.prisma.course.findMany({
        where: { teacherId: userId, archivedAt: null },
        include: this.listInclude,
        orderBy: { createdAt: 'desc' },
      });
    }

    // Student: published courses they're enrolled in
    return this.prisma.course.findMany({
      where: {
        enrollments: { some: { studentId: userId } },
        status: 'PUBLISHED',
        archivedAt: null,
      },
      include: {
        teacher: { select: { id: true, name: true, email: true } },
        topics: {
          orderBy: { orderIndex: 'asc' as const },
          include: { _count: { select: { questions: true } } },
        },
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
          include: { _count: { select: { questions: true } } },
        },
        modules: {
          orderBy: { orderIndex: 'asc' },
          include: {
            items: { orderBy: { orderIndex: 'asc' } },
          },
        },
        _count: { select: { enrollments: true, topics: true, modules: true } },
      },
    });

    if (!course) {
      throw new NotFoundException(`Course ${id} not found`);
    }

    return course;
  }

  async update(id: string, teacherId: string, dto: UpdateCourse & Record<string, unknown>) {
    const course = await this.prisma.course.findUnique({ where: { id } });

    if (!course) throw new NotFoundException(`Course ${id} not found`);
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update your own courses');
    }

    return this.prisma.course.update({
      where: { id },
      data: dto,
      include: this.listInclude,
    });
  }

  async publish(id: string, teacherId: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException(`Course ${id} not found`);
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only publish your own courses');
    }

    return this.prisma.course.update({
      where: { id },
      data: { status: 'PUBLISHED' },
      include: this.listInclude,
    });
  }

  async unpublish(id: string, teacherId: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException(`Course ${id} not found`);
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only unpublish your own courses');
    }

    return this.prisma.course.update({
      where: { id },
      data: { status: 'DRAFT' },
      include: this.listInclude,
    });
  }

  async duplicate(id: string, teacherId: string) {
    const source = await this.prisma.course.findUnique({
      where: { id },
      include: {
        modules: {
          orderBy: { orderIndex: 'asc' },
          include: {
            items: { orderBy: { orderIndex: 'asc' } },
          },
        },
      },
    });

    if (!source) throw new NotFoundException(`Course ${id} not found`);
    if (source.teacherId !== teacherId) {
      throw new ForbiddenException('You can only duplicate your own courses');
    }

    // Deep clone: course + modules + items
    const newCourse = await this.prisma.course.create({
      data: {
        title: `${source.title} (Copy)`,
        description: source.description,
        teacherId,
        status: 'DRAFT',
        visibility: source.visibility,
        modules: {
          create: source.modules.map((mod) => ({
            title: mod.title,
            orderIndex: mod.orderIndex,
            items: {
              create: mod.items.map((item) => ({
                type: item.type,
                title: item.title,
                orderIndex: item.orderIndex,
                contentMdx: item.contentMdx,
                pdfBlobKey: item.pdfBlobKey,
                pdfFilename: item.pdfFilename,
                pdfSize: item.pdfSize,
                url: item.url,
                assessmentId: item.assessmentId,
              })),
            },
          })),
        },
      },
      include: this.listInclude,
    });

    return newCourse;
  }

  async remove(id: string, teacherId: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException(`Course ${id} not found`);
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only delete your own courses');
    }

    // Soft delete: set archivedAt, keep attempt data
    return this.prisma.course.update({
      where: { id },
      data: { archivedAt: new Date() },
    });
  }
}
