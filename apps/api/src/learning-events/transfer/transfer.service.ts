import { BadRequestException, Injectable } from '@nestjs/common';
import type { LessonDocument } from '@ats/shared';
import { PrismaService } from '../../prisma';

/**
 * Transfer-task scoring (plan Phase 5.3): the teacher/researcher scores each
 * learner's unassisted prompt on the task's rubric (0–2 per criterion, the
 * course's self-score scale). Scores feed the outcomes export.
 */
@Injectable()
export class TransferTaskService {
  constructor(private readonly prisma: PrismaService) {}

  private async transferSlides(courseId: string) {
    const items = await this.prisma.moduleItem.findMany({
      where: { module: { courseId }, type: 'INTERACTIVE_LESSON' },
      select: { id: true, title: true, lessonJson: true },
    });
    return items.flatMap((it) =>
      ((it.lessonJson as unknown as LessonDocument | null)?.slides ?? [])
        .filter((s) => s.t === 'transfer')
        .map((s) => ({
          moduleItemId: it.id,
          itemTitle: it.title,
          slideKey: s.key,
          criteria: s.criteria ?? [],
        })),
    );
  }

  async submissions(courseId: string) {
    const slides = await this.transferSlides(courseId);
    const out = [];
    for (const sl of slides) {
      const [states, scores] = await Promise.all([
        this.prisma.lessonSlideState.findMany({
          where: { moduleItemId: sl.moduleItemId, slideKey: sl.slideKey },
          select: {
            studentId: true,
            state: true,
            updatedAt: true,
            student: { select: { name: true } },
          },
        }),
        this.prisma.transferTaskScore.findMany({
          where: { moduleItemId: sl.moduleItemId, slideKey: sl.slideKey },
        }),
      ]);
      for (const st of states) {
        const text = (st.state as { fields?: { text?: unknown } }).fields?.text;
        if (typeof text !== 'string' || !text.trim()) continue;
        out.push({
          ...sl,
          studentId: st.studentId,
          studentName: st.student.name,
          submittedAt: st.updatedAt,
          prompt: text,
          scores: scores.filter((s) => s.studentId === st.studentId),
        });
      }
    }
    return { courseId, tasks: slides, submissions: out };
  }

  async score(
    courseId: string,
    scorerId: string,
    body: {
      studentId: string;
      moduleItemId: string;
      slideKey: string;
      scores: number[];
      note?: string;
    },
  ) {
    const slide = (await this.transferSlides(courseId)).find(
      (s) => s.moduleItemId === body.moduleItemId && s.slideKey === body.slideKey,
    );
    if (!slide) throw new BadRequestException('Not a transfer task in this course');
    if (
      body.scores.length !== slide.criteria.length ||
      body.scores.some((v) => ![0, 1, 2].includes(v))
    ) {
      throw new BadRequestException(
        `Give one score of 0, 1 or 2 for each of the ${slide.criteria.length} criteria`,
      );
    }
    const total = body.scores.reduce((a, b) => a + b, 0);
    const data = {
      scores: body.scores,
      total,
      maxTotal: slide.criteria.length * 2,
      note: body.note ?? null,
    };
    return this.prisma.transferTaskScore.upsert({
      where: {
        studentId_moduleItemId_slideKey_scorerId: {
          studentId: body.studentId,
          moduleItemId: body.moduleItemId,
          slideKey: body.slideKey,
          scorerId,
        },
      },
      create: {
        studentId: body.studentId,
        moduleItemId: body.moduleItemId,
        slideKey: body.slideKey,
        scorerId,
        ...data,
      },
      update: data,
    });
  }
}
