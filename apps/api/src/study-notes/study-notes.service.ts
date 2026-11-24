import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { StudyNote as StudyNoteRow } from '@prisma/client';
import {
  STUDY_NOTES_PER_COURSE_MAX,
  type CreateStudyNoteSchema,
  type StudyNote,
  type UpdateStudyNote,
} from '@ats/shared';
import type { z } from 'zod';
import { PrismaService } from '../prisma';
import { CourseGateService } from '../course-gates';

type CreateInput = z.output<typeof CreateStudyNoteSchema>;

function toDto(n: StudyNoteRow): StudyNote {
  return {
    id: n.id,
    courseId: n.courseId,
    moduleItemId: n.moduleItemId,
    slideKey: n.slideKey,
    location: n.location,
    source: n.source as StudyNote['source'],
    quote: n.quote,
    prefix: n.prefix,
    suffix: n.suffix,
    color: n.color as StudyNote['color'],
    body: n.body,
    createdAt: n.createdAt.toISOString(),
    updatedAt: n.updatedAt.toISOString(),
  };
}

/**
 * A student's own highlights and notes. Only ever read or changed by the
 * student who wrote them; staff have no route to them (research access, if
 * wanted later, goes through the governed export, not this service).
 */
@Injectable()
export class StudyNotesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly gates: CourseGateService,
  ) {}

  private async assertEnrolled(studentId: string, courseId: string) {
    const e = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId, courseId } },
      select: { status: true },
    });
    if (e?.status !== 'ACTIVE') throw new ForbiddenException('You are not enrolled in this course');
  }

  async list(studentId: string, courseId: string): Promise<StudyNote[]> {
    await this.assertEnrolled(studentId, courseId);
    const rows = await this.prisma.studyNote.findMany({
      where: { studentId, courseId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map(toDto);
  }

  async create(studentId: string, input: CreateInput): Promise<StudyNote> {
    await this.assertEnrolled(studentId, input.courseId);
    if (input.moduleItemId) {
      const item = await this.prisma.moduleItem.findUnique({
        where: { id: input.moduleItemId },
        select: { module: { select: { courseId: true } } },
      });
      if (!item || item.module.courseId !== input.courseId) {
        throw new BadRequestException('That item is not in this course');
      }
      // Gated (locked) sessions cannot be annotated: their content is hidden.
      await this.gates.assertItemAccess(studentId, input.moduleItemId);
    }
    const count = await this.prisma.studyNote.count({
      where: { studentId, courseId: input.courseId },
    });
    if (count >= STUDY_NOTES_PER_COURSE_MAX) {
      throw new BadRequestException('You have reached the maximum number of notes for this course');
    }
    const row = await this.prisma.studyNote.create({
      data: {
        studentId,
        courseId: input.courseId,
        moduleItemId: input.moduleItemId ?? null,
        slideKey: input.slideKey ?? null,
        location: input.location,
        source: input.source,
        quote: input.quote?.trim() ? input.quote : null,
        prefix: input.prefix ?? null,
        suffix: input.suffix ?? null,
        color: input.color ?? null,
        body: input.body,
      },
    });
    return toDto(row);
  }

  private async own(studentId: string, id: string) {
    const row = await this.prisma.studyNote.findUnique({ where: { id } });
    if (!row || row.studentId !== studentId) throw new NotFoundException('Note not found');
    return row;
  }

  async update(studentId: string, id: string, patch: UpdateStudyNote): Promise<StudyNote> {
    const row = await this.own(studentId, id);
    const body = patch.body ?? row.body;
    if (!row.quote && !body.trim()) {
      throw new BadRequestException('A note needs some text. Delete it instead.');
    }
    const updated = await this.prisma.studyNote.update({
      where: { id },
      data: {
        ...(patch.body !== undefined ? { body: patch.body } : {}),
        ...(patch.color !== undefined ? { color: patch.color } : {}),
      },
    });
    return toDto(updated);
  }

  async remove(studentId: string, id: string): Promise<{ ok: true }> {
    await this.own(studentId, id);
    await this.prisma.studyNote.delete({ where: { id } });
    return { ok: true };
  }
}
