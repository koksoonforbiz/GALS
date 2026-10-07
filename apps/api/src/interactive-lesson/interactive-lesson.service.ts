import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  Optional,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  LESSON_SLIDE_STATE_MAX_BYTES,
  type LessonDocument,
  type LessonSlideState,
  type UserRole,
} from '@ats/shared';
import { PrismaService } from '../prisma';
import { TextConsentService } from '../governance/text-consent.service';

export interface LessonViewer {
  id: string;
  role: UserRole;
}

@Injectable()
export class InteractiveLessonService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly consent?: TextConsentService,
  ) {}

  /**
   * Loads an INTERACTIVE_LESSON item and checks the caller may see it:
   * students must hold an ACTIVE enrollment; teachers must own the course;
   * admins see everything.
   */
  private async loadAuthorized(itemId: string, viewer: LessonViewer) {
    const item = await this.prisma.moduleItem.findUnique({
      where: { id: itemId },
      select: {
        id: true,
        type: true,
        title: true,
        moduleId: true,
        lessonJson: true,
        module: { select: { courseId: true, course: { select: { teacherId: true } } } },
      },
    });
    if (!item || item.type !== 'INTERACTIVE_LESSON' || !item.lessonJson) {
      throw new NotFoundException('Interactive lesson not found');
    }
    const courseId = item.module.courseId;
    if (viewer.role === 'student') {
      const enrollment = await this.prisma.enrollment.findUnique({
        where: { studentId_courseId: { studentId: viewer.id, courseId } },
        select: { status: true },
      });
      if (enrollment?.status !== 'ACTIVE') {
        throw new ForbiddenException('You are not enrolled in this course');
      }
    } else if (viewer.role === 'teacher' && item.module.course.teacherId !== viewer.id) {
      throw new ForbiddenException('You can only view lessons in your own courses');
    }
    return { item, courseId, lesson: item.lessonJson as unknown as LessonDocument };
  }

  async getLesson(itemId: string, viewer: LessonViewer) {
    const { item, courseId, lesson } = await this.loadAuthorized(itemId, viewer);
    let state: Record<string, LessonSlideState> = {};
    if (viewer.role === 'student') {
      const rows = await this.prisma.lessonSlideState.findMany({
        where: { studentId: viewer.id, moduleItemId: itemId },
        select: { slideKey: true, state: true },
      });
      state = Object.fromEntries(
        rows.map((r) => [r.slideKey, r.state as unknown as LessonSlideState]),
      );
    }
    // Students get their text-capture decision (Phase 6): null = not asked
    // yet → the client shows the notice and captures no free text.
    const consent =
      viewer.role === 'student' && this.consent
        ? await this.consent.current(viewer.id, courseId)
        : null;
    return {
      item: { id: item.id, title: item.title, moduleId: item.moduleId, courseId },
      lesson,
      state,
      consent,
    };
  }

  async saveSlideState(
    itemId: string,
    slideKey: string,
    studentId: string,
    state: LessonSlideState,
    sessionId?: string,
  ) {
    const { lesson } = await this.loadAuthorized(itemId, { id: studentId, role: 'student' });
    if (!lesson.slides.some((s) => s.key === slideKey)) {
      throw new BadRequestException(`Unknown slide "${slideKey}"`);
    }
    if (Buffer.byteLength(JSON.stringify(state), 'utf8') > LESSON_SLIDE_STATE_MAX_BYTES) {
      throw new PayloadTooLargeException('Slide state too large');
    }
    const json = state as unknown as Prisma.InputJsonValue;
    const row = await this.prisma.lessonSlideState.upsert({
      where: { studentId_moduleItemId_slideKey: { studentId, moduleItemId: itemId, slideKey } },
      create: {
        studentId,
        moduleItemId: itemId,
        slideKey,
        state: json,
        lastSessionId: sessionId ?? null,
      },
      update: { state: json, lastSessionId: sessionId ?? null },
      select: { slideKey: true, updatedAt: true },
    });
    return { ok: true, slideKey: row.slideKey, updatedAt: row.updatedAt };
  }
}
