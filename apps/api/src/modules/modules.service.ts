import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma';

@Injectable()
export class ModulesService {
  constructor(private readonly prisma: PrismaService) {}

  private async verifyCourseOwnership(courseId: string, teacherId: string) {
    const course = await this.prisma.course.findUnique({ where: { id: courseId } });
    if (!course) throw new NotFoundException(`Course ${courseId} not found`);
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only manage modules in your own courses');
    }
    return course;
  }

  private async verifyModuleOwnership(moduleId: string, teacherId: string) {
    const mod = await this.prisma.courseModule.findUnique({
      where: { id: moduleId },
      include: { course: true },
    });
    if (!mod) throw new NotFoundException(`Module ${moduleId} not found`);
    if (mod.course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only manage modules in your own courses');
    }
    return mod;
  }

  async create(courseId: string, teacherId: string, dto: { title: string }) {
    await this.verifyCourseOwnership(courseId, teacherId);

    const maxOrder = await this.prisma.courseModule.aggregate({
      where: { courseId },
      _max: { orderIndex: true },
    });

    return this.prisma.courseModule.create({
      data: {
        courseId,
        title: dto.title,
        orderIndex: (maxOrder._max.orderIndex ?? -1) + 1,
      },
      include: { items: { orderBy: { orderIndex: 'asc' } } },
    });
  }

  async update(moduleId: string, teacherId: string, dto: { title?: string }) {
    await this.verifyModuleOwnership(moduleId, teacherId);

    return this.prisma.courseModule.update({
      where: { id: moduleId },
      data: dto,
      include: { items: { orderBy: { orderIndex: 'asc' } } },
    });
  }

  async remove(moduleId: string, teacherId: string) {
    await this.verifyModuleOwnership(moduleId, teacherId);
    await this.prisma.courseModule.delete({ where: { id: moduleId } });
    return { deleted: true };
  }

  async reorder(courseId: string, teacherId: string, orderedIds: string[]) {
    await this.verifyCourseOwnership(courseId, teacherId);

    await this.prisma.$transaction(
      orderedIds.map((id, index) =>
        this.prisma.courseModule.update({
          where: { id },
          data: { orderIndex: index },
        }),
      ),
    );

    return this.prisma.courseModule.findMany({
      where: { courseId },
      orderBy: { orderIndex: 'asc' },
      include: { items: { orderBy: { orderIndex: 'asc' } } },
    });
  }
}
