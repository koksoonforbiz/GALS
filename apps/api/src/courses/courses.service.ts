import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import { DialogueCourseSettingsSchema } from '@ats/shared';
import type { CreateCourse, UpdateCourse, UserRole } from '@ats/shared';
import { getChatModel, isSelectable, type LlmProvider } from '../llm/model-registry';

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
    const { learningMode, dblSettings, ...rest } = dto;

    // If DIALOGUE mode, validate LLM credentials exist
    if (learningMode === 'DIALOGUE') {
      const teacher = await this.prisma.user.findUnique({
        where: { id: teacherId },
        select: { encryptedApiKey: true },
      });
      if (!teacher?.encryptedApiKey) {
        throw new BadRequestException(
          'Dialogue mode requires LLM API credentials. Please configure them in LLM Settings.',
        );
      }
    }

    return this.prisma.course.create({
      data: {
        ...rest,
        teacherId,
        status: 'DRAFT',
        learningMode: learningMode || 'STANDARD',
        dblSettings: dblSettings ? (dblSettings as object) : undefined,
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

  async findCatalog() {
    return this.prisma.course.findMany({
      where: {
        status: 'PUBLISHED',
        visibility: 'PUBLIC',
        archivedAt: null,
      },
      select: {
        id: true,
        title: true,
        description: true,
        bannerBlobKey: true,
        createdAt: true,
        // Prompt 03: surface the self-enroll flag so the student
        // CatalogPage can hide the Enroll button when it's off.
        // (Backend `selfEnroll()` still enforces it as the source of
        // truth — this is purely cosmetic UI hiding.)
        allowStudentSelfEnroll: true,
        teacher: { select: { id: true, name: true } },
        _count: { select: { modules: true, enrollments: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  // Prompt 03: per-course enrollment policy update. Lives next to the
  // existing per-course PATCH but exposed as a dedicated method so the
  // controller can validate the partial DTO independently.
  async updateEnrollmentPolicy(
    id: string,
    teacherId: string,
    flags: { allowStudentSelfEnroll?: boolean; allowStudentSelfDrop?: boolean },
  ) {
    const course = await this.prisma.course.findUnique({
      where: { id },
      select: { id: true, teacherId: true },
    });
    if (!course) throw new NotFoundException(`Course ${id} not found`);
    const teacher = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { role: true },
    });
    if (teacher?.role !== 'admin' && course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update settings for your own courses');
    }

    return this.prisma.course.update({
      where: { id },
      data: {
        ...(flags.allowStudentSelfEnroll !== undefined && {
          allowStudentSelfEnroll: flags.allowStudentSelfEnroll,
        }),
        ...(flags.allowStudentSelfDrop !== undefined && {
          allowStudentSelfDrop: flags.allowStudentSelfDrop,
        }),
      },
      select: {
        id: true,
        allowStudentSelfEnroll: true,
        allowStudentSelfDrop: true,
      },
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
      data: { status: 'PUBLISHED', visibility: 'PUBLIC' },
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

  async getDialogueSettings(id: string, teacherId: string) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException(`Course ${id} not found`);
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only view settings for your own courses');
    }

    const defaults = DialogueCourseSettingsSchema.parse({});
    const current = course.dblSettings
      ? DialogueCourseSettingsSchema.safeParse(course.dblSettings)
      : { success: false as const };

    return {
      learningMode: course.learningMode,
      settings: current.success ? current.data : defaults,
    };
  }

  async updateDialogueSettings(id: string, teacherId: string, settings: Record<string, unknown>) {
    const course = await this.prisma.course.findUnique({ where: { id } });
    if (!course) throw new NotFoundException(`Course ${id} not found`);
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException('You can only update settings for your own courses');
    }

    // Merge existing settings with new ones
    const existing = course.dblSettings
      ? DialogueCourseSettingsSchema.safeParse(course.dblSettings)
      : { success: false as const };

    const merged = {
      ...(existing.success ? existing.data : {}),
      ...settings,
    };

    const parsed = DialogueCourseSettingsSchema.safeParse(merged);
    if (!parsed.success) {
      throw new BadRequestException(`Invalid DBL settings: ${parsed.error.message}`);
    }

    // Stage 2 LLM upgrade: validate the chat model against the registry,
    // not just trust whatever string the client posted. `fallback`
    // provider (no API key) skips this — it has no real model id.
    if (parsed.data.llmProvider !== 'fallback') {
      const provider = parsed.data.llmProvider as LlmProvider;
      const spec = getChatModel(parsed.data.llmModel);
      if (!spec) {
        throw new BadRequestException(
          `Unknown chat model "${parsed.data.llmModel}". Pick a model from /llm/models?provider=${provider}.`,
        );
      }
      if (spec.provider !== provider) {
        throw new BadRequestException(
          `Chat model "${parsed.data.llmModel}" belongs to provider "${spec.provider}", not "${provider}".`,
        );
      }
      if (!isSelectable(spec.id)) {
        throw new BadRequestException(
          `Chat model "${parsed.data.llmModel}" is retired and can no longer be selected.`,
        );
      }
    }

    // If provider isn't 'fallback', check LLM credentials
    if (parsed.data.llmProvider !== 'fallback') {
      const teacher = await this.prisma.user.findUnique({
        where: { id: teacherId },
        select: { encryptedApiKey: true },
      });
      if (!teacher?.encryptedApiKey) {
        throw new BadRequestException(
          'Non-fallback LLM provider requires API credentials. Please configure them in LLM Settings.',
        );
      }
    }

    return this.prisma.course.update({
      where: { id },
      data: { dblSettings: parsed.data as object },
      include: this.listInclude,
    });
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
