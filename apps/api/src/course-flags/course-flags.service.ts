import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma';

/**
 * Learner-visible prompts (Prompt B, P5d; WP5 G1, G2, G9), one switch each
 * per course. PI decision 2026-11-25: on for everyone, so a course with no
 * row has every prompt on; a teacher can switch one off (or on again) for
 * their course. Rows are append-only and the latest row per flag wins, so
 * when a prompt was switched on or off is kept.
 */
export const LEARNER_PROMPTS = [
  'goal_card',
  'intention_tag',
  'progress_check',
  'confidence_slider',
  'resume_prompt',
  'session_reflection',
] as const;
export type LearnerPrompt = (typeof LEARNER_PROMPTS)[number];

@Injectable()
export class CourseFlagsService {
  constructor(private readonly prisma: PrismaService) {}

  async flags(courseId: string): Promise<Record<LearnerPrompt, boolean>> {
    const rows = await this.prisma.courseFeatureFlag.findMany({
      where: { courseId },
      orderBy: { changedAt: 'asc' },
      select: { flag: true, enabled: true },
    });
    const out = Object.fromEntries(LEARNER_PROMPTS.map((f) => [f, true])) as Record<
      LearnerPrompt,
      boolean
    >;
    for (const r of rows)
      if ((LEARNER_PROMPTS as readonly string[]).includes(r.flag))
        out[r.flag as LearnerPrompt] = r.enabled;
    return out;
  }

  /** Students: enrolled in the course. Teachers: own course. Admins: any. */
  async assertCanRead(user: { id: string; role: string }, courseId: string) {
    if (user.role === 'admin') return;
    if (user.role === 'teacher') return this.assertOwns(user, courseId);
    const e = await this.prisma.enrollment.findUnique({
      where: { studentId_courseId: { studentId: user.id, courseId } },
      select: { status: true },
    });
    if (e?.status !== 'ACTIVE') throw new ForbiddenException('Not enrolled in this course');
  }

  async assertOwns(user: { id: string; role: string }, courseId: string) {
    const c = await this.prisma.course.findUnique({
      where: { id: courseId },
      select: { teacherId: true },
    });
    if (!c) throw new NotFoundException('Course not found');
    if (user.role !== 'admin' && c.teacherId !== user.id)
      throw new ForbiddenException('Not your course');
  }

  async set(courseId: string, flag: LearnerPrompt, enabled: boolean, by: string) {
    await this.prisma.courseFeatureFlag.create({
      data: { courseId, flag, enabled, changedBy: by },
    });
    return this.flags(courseId);
  }

  async history(courseId: string) {
    return this.prisma.courseFeatureFlag.findMany({
      where: { courseId },
      orderBy: { changedAt: 'asc' },
    });
  }
}
