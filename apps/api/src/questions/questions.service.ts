import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../prisma';
import type { CreateQuestion, UpdateQuestion } from '@ats/shared';

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

/** Standard KC include used across multiple queries */
const KC_INCLUDE = {
  questionKcs: {
    include: { kc: { select: { id: true, code: true, label: true } } },
  },
} as const;

/** Full relation payload for single-question reads */
const FULL_INCLUDE = {
  course: { select: { id: true, title: true, teacherId: true } },
  topic: {
    include: {
      course: { select: { id: true, title: true, teacherId: true } },
    },
  },
  ...KC_INCLUDE,
} as const;

interface FindByCourseFilters {
  type?: string;
  status?: string;
  difficulty?: number;
  bloomsLevel?: string;
  search?: string;
}

interface FindAllFilters extends FindByCourseFilters {
  courseId?: string;
}

/* ------------------------------------------------------------------ */
/*  Service                                                            */
/* ------------------------------------------------------------------ */

@Injectable()
export class QuestionsService {
  constructor(private readonly prisma: PrismaService) {}

  /* ================================================================ */
  /*  CREATE                                                           */
  /* ================================================================ */

  async create(teacherId: string, dto: CreateQuestion) {
    // --- ownership checks ----------------------------------------- */
    if (dto.courseId) {
      await this.verifyCourseOwnership(dto.courseId, teacherId);
    }

    if (dto.topicId) {
      await this.verifyTopicOwnership(dto.topicId, teacherId);
    }

    if (!dto.courseId && !dto.topicId) {
      throw new BadRequestException(
        'Either courseId or topicId must be provided',
      );
    }

    // --- MCQ validations ------------------------------------------ */
    this.validateMCQOptions(dto);

    // --- persist -------------------------------------------------- */
    const question = await this.prisma.question.create({
      data: {
        courseId: dto.courseId ?? null,
        topicId: dto.topicId ?? null,
        prompt: dto.prompt,
        stem: dto.stem === null
          ? null
          : (dto.stem as any | undefined),
        type: dto.type,
        maxScore: dto.maxScore,
        rubricJson: dto.rubricJson === null
          ? null
          : (dto.rubricJson as any | undefined),
        options: dto.options === null
          ? null
          : (dto.options as any | undefined),
        correctOptionId: dto.correctOptionId ?? null,
        correctAnswer: dto.correctAnswer === null
          ? null
          : (dto.correctAnswer as any | undefined),
        explanation: dto.explanation === null
          ? null
          : (dto.explanation as any | undefined),
        difficulty: dto.difficulty ?? null,
        bloomsLevel: dto.bloomsLevel ?? null,
        kcIds: dto.kcIds ?? [],
        pageIds: dto.pageIds ?? [],
        tags: dto.tags === null
          ? null
          : (dto.tags as any | undefined),
        status: dto.status ?? 'draft',
        createdBy: dto.createdBy ?? null,
        sourceType: dto.sourceType ?? null,
      },
    });

    // Link KCs via join table
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

  /* ================================================================ */
  /*  READ – by course (Question Bank primary listing)                 */
  /* ================================================================ */

  async findByCourse(courseId: string, filters: FindByCourseFilters = {}) {
    const where: Record<string, any> = { courseId };

    if (filters.type) where.type = filters.type as never;
    if (filters.status) where.status = filters.status;
    if (filters.difficulty) where.difficulty = filters.difficulty;
    if (filters.bloomsLevel) where.bloomsLevel = filters.bloomsLevel;
    if (filters.search) {
      where.prompt = { contains: filters.search, mode: 'insensitive' };
    }

    return this.prisma.question.findMany({
      where,
      include: KC_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  /* ================================================================ */
  /*  READ – all questions for courses owned by a teacher              */
  /* ================================================================ */

  async findAll(teacherId: string, filters: FindAllFilters = {}) {
    // Find all courses owned by this teacher
    const courses = await this.prisma.course.findMany({
      where: { teacherId },
      select: { id: true },
    });

    const courseIds = courses.map((c: any) => c.id);

    const where: Record<string, any> = {
      OR: [
        { courseId: { in: courseIds } },
        { topic: { course: { teacherId } } },
      ],
    };

    if (filters.courseId) {
      // Scope to a specific course (must still be owned by teacher)
      if (!courseIds.includes(filters.courseId)) {
        throw new ForbiddenException('You do not own this course');
      }
      where.OR = undefined;
      where.courseId = filters.courseId;
    }

    if (filters.type) where.type = filters.type as never;
    if (filters.status) where.status = filters.status;
    if (filters.difficulty) where.difficulty = filters.difficulty;
    if (filters.bloomsLevel) where.bloomsLevel = filters.bloomsLevel;
    if (filters.search) {
      where.prompt = { contains: filters.search, mode: 'insensitive' };
    }

    return this.prisma.question.findMany({
      where,
      include: {
        ...KC_INCLUDE,
        course: { select: { id: true, title: true } },
        topic: { select: { id: true, title: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  /* ================================================================ */
  /*  READ – by topic (backward compat)                                */
  /* ================================================================ */

  async findByTopic(topicId: string) {
    return this.prisma.question.findMany({
      where: { topicId },
      include: KC_INCLUDE,
      orderBy: { createdAt: 'asc' },
    });
  }

  /* ================================================================ */
  /*  READ – single                                                    */
  /* ================================================================ */

  async findOne(id: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: FULL_INCLUDE,
    });

    if (!question) {
      throw new NotFoundException(`Question ${id} not found`);
    }

    return question;
  }

  /* ================================================================ */
  /*  UPDATE                                                           */
  /* ================================================================ */

  async update(id: string, teacherId: string, dto: UpdateQuestion) {
    const question = await this.findOneWithOwnerCheck(id, teacherId);

    // If moving to a different course / topic, verify ownership
    if (dto.courseId && dto.courseId !== question.courseId) {
      await this.verifyCourseOwnership(dto.courseId, teacherId);
    }
    if (dto.topicId && dto.topicId !== question.topicId) {
      await this.verifyTopicOwnership(dto.topicId, teacherId);
    }

    // MCQ validations if type or options are changing
    if (dto.type || dto.options) {
      const merged = { ...question, ...dto } as CreateQuestion;
      this.validateMCQOptions(merged);
    }

    const updateData: Record<string, any> = {
      version: { increment: 1 },
    };

    // Simple scalars
    if (dto.prompt !== undefined) updateData.prompt = dto.prompt;
    if (dto.type !== undefined) updateData.type = dto.type;
    if (dto.maxScore !== undefined) updateData.maxScore = dto.maxScore;
    if (dto.courseId !== undefined) updateData.course = dto.courseId
      ? { connect: { id: dto.courseId } }
      : { disconnect: true };
    if (dto.topicId !== undefined) updateData.topic = dto.topicId
      ? { connect: { id: dto.topicId } }
      : { disconnect: true };
    if (dto.correctOptionId !== undefined) updateData.correctOptionId = dto.correctOptionId ?? null;
    if (dto.difficulty !== undefined) updateData.difficulty = dto.difficulty ?? null;
    if (dto.bloomsLevel !== undefined) updateData.bloomsLevel = dto.bloomsLevel ?? null;
    if (dto.status !== undefined) updateData.status = dto.status;
    if (dto.createdBy !== undefined) updateData.createdBy = dto.createdBy ?? null;
    if (dto.sourceType !== undefined) updateData.sourceType = dto.sourceType ?? null;

    // JSON fields
    if (dto.rubricJson !== undefined) {
      updateData.rubricJson = dto.rubricJson === null
        ? null
        : (dto.rubricJson as any);
    }
    if (dto.stem !== undefined) {
      updateData.stem = dto.stem === null
        ? null
        : (dto.stem as any);
    }
    if (dto.options !== undefined) {
      updateData.options = dto.options === null
        ? null
        : (dto.options as any);
    }
    if (dto.correctAnswer !== undefined) {
      updateData.correctAnswer = dto.correctAnswer === null
        ? null
        : (dto.correctAnswer as any);
    }
    if (dto.explanation !== undefined) {
      updateData.explanation = dto.explanation === null
        ? null
        : (dto.explanation as any);
    }
    if (dto.tags !== undefined) {
      updateData.tags = dto.tags === null
        ? null
        : (dto.tags as any);
    }

    // Array fields
    if (dto.kcIds !== undefined) updateData.kcIds = dto.kcIds ?? [];
    if (dto.pageIds !== undefined) updateData.pageIds = dto.pageIds ?? [];

    const updated = await this.prisma.question.update({
      where: { id },
      data: updateData,
    });

    // Update KC join-table links if provided
    if (dto.kcIds !== undefined) {
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

  /* ================================================================ */
  /*  DELETE                                                           */
  /* ================================================================ */

  async remove(id: string, teacherId: string) {
    await this.findOneWithOwnerCheck(id, teacherId);
    await this.prisma.question.delete({ where: { id } });
    return { deleted: true };
  }

  /* ================================================================ */
  /*  BULK IMPORT                                                      */
  /* ================================================================ */

  async bulkImport(
    teacherId: string,
    courseId: string,
    questions: CreateQuestion[],
  ) {
    await this.verifyCourseOwnership(courseId, teacherId);

    const results = [];

    for (const dto of questions) {
      const created = await this.create(teacherId, {
        ...dto,
        courseId,
      });
      results.push(created);
    }

    return results;
  }

  /* ================================================================ */
  /*  BULK UPDATE STATUS                                               */
  /* ================================================================ */

  async bulkUpdateStatus(teacherId: string, ids: string[], status: string) {
    // Verify ownership for every question
    const questions = await this.prisma.question.findMany({
      where: { id: { in: ids } },
      include: {
        course: { select: { teacherId: true } },
        topic: { include: { course: { select: { teacherId: true } } } },
      },
    });

    if (questions.length !== ids.length) {
      throw new NotFoundException('One or more questions not found');
    }

    for (const q of questions) {
      const owner =
        q.course?.teacherId ?? q.topic?.course?.teacherId ?? null;
      if (owner !== teacherId) {
        throw new ForbiddenException(
          `You do not own question ${q.id}`,
        );
      }
    }

    await this.prisma.question.updateMany({
      where: { id: { in: ids } },
      data: { status, version: { increment: 1 } },
    });

    return { updated: ids.length };
  }

  /* ================================================================ */
  /*  DUPLICATE                                                        */
  /* ================================================================ */

  async duplicate(id: string, teacherId: string) {
    const original = await this.findOne(id);

    // Verify ownership
    const owner =
      original.course?.teacherId ??
      original.topic?.course?.teacherId ??
      null;
    if (owner !== teacherId) {
      throw new ForbiddenException('You can only duplicate your own questions');
    }

    const duplicate = await this.prisma.question.create({
      data: {
        courseId: original.courseId ?? null,
        topicId: original.topicId ?? null,
        prompt: original.prompt,
        stem: original.stem === null
          ? null
          : (original.stem as any),
        type: original.type,
        maxScore: original.maxScore,
        rubricJson: original.rubricJson === null
          ? null
          : (original.rubricJson as any),
        options: original.options === null
          ? null
          : (original.options as any),
        correctOptionId: original.correctOptionId ?? null,
        correctAnswer: original.correctAnswer === null
          ? null
          : (original.correctAnswer as any),
        explanation: original.explanation === null
          ? null
          : (original.explanation as any),
        difficulty: original.difficulty ?? null,
        bloomsLevel: original.bloomsLevel ?? null,
        kcIds: original.kcIds ?? [],
        pageIds: original.pageIds ?? [],
        tags: original.tags === null
          ? null
          : (original.tags as any),
        status: 'draft',
        createdBy: original.createdBy ?? null,
        sourceType: original.sourceType ?? null,
      },
    });

    // Duplicate KC join-table links
    if (original.questionKcs && original.questionKcs.length > 0) {
      await this.prisma.questionKc.createMany({
        data: original.questionKcs.map((qk: any) => ({
          questionId: duplicate.id,
          kcId: qk.kcId,
        })),
      });
    }

    return duplicate;
  }

  /* ================================================================ */
  /*  ARCHIVE                                                          */
  /* ================================================================ */

  async archive(id: string, teacherId: string) {
    await this.findOneWithOwnerCheck(id, teacherId);

    return this.prisma.question.update({
      where: { id },
      data: { status: 'archived', version: { increment: 1 } },
    });
  }

  /* ================================================================ */
  /*  Private helpers                                                  */
  /* ================================================================ */

  /**
   * Validate MCQ option constraints:
   * - MCQ_SINGLE: exactly one option marked correct (or correctOptionId set)
   * - MCQ_MULTI: at least one option marked correct
   */
  private validateMCQOptions(dto: CreateQuestion) {
    if (dto.type === 'MCQ_SINGLE') {
      if (!dto.options || dto.options.length === 0) {
        throw new BadRequestException(
          'MCQ_SINGLE questions require at least one option',
        );
      }
      const correctCount = dto.options.filter((o) => o.isCorrect).length;
      if (correctCount !== 1 && !dto.correctOptionId) {
        throw new BadRequestException(
          'MCQ_SINGLE questions must have exactly one correct option or correctOptionId set',
        );
      }
    }

    if (dto.type === 'MCQ_MULTI') {
      if (!dto.options || dto.options.length === 0) {
        throw new BadRequestException(
          'MCQ_MULTI questions require at least one option',
        );
      }
      const correctCount = dto.options.filter((o) => o.isCorrect).length;
      if (correctCount < 1) {
        throw new BadRequestException(
          'MCQ_MULTI questions must have at least one correct option',
        );
      }
    }
  }

  /** Verify a course exists and is owned by the teacher */
  private async verifyCourseOwnership(courseId: string, teacherId: string) {
    const course = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });

    if (!course) {
      throw new NotFoundException(`Course ${courseId} not found`);
    }
    if (course.teacherId !== teacherId) {
      throw new ForbiddenException(
        'You can only manage questions in your own courses',
      );
    }
  }

  /** Verify a topic's course is owned by the teacher */
  private async verifyTopicOwnership(topicId: string, teacherId: string) {
    const topic = await this.prisma.topic.findUnique({
      where: { id: topicId },
      include: { course: { select: { teacherId: true } } },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${topicId} not found`);
    }
    if (topic.course.teacherId !== teacherId) {
      throw new ForbiddenException(
        'You can only add questions to your own courses',
      );
    }
  }

  /**
   * Load a question and verify that the teacher owns the parent
   * course (directly or via topic). Returns the question on success.
   */
  private async findOneWithOwnerCheck(id: string, teacherId: string) {
    const question = await this.prisma.question.findUnique({
      where: { id },
      include: {
        course: { select: { teacherId: true } },
        topic: { include: { course: { select: { teacherId: true } } } },
      },
    });

    if (!question) {
      throw new NotFoundException(`Question ${id} not found`);
    }

    const owner =
      question.course?.teacherId ??
      question.topic?.course?.teacherId ??
      null;

    if (owner !== teacherId) {
      throw new ForbiddenException(
        'You can only manage questions in your own courses',
      );
    }

    return question;
  }
}
