import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma';
import type { CreateKc, MasteryByTopic, KcMasteryItem } from '@ats/shared';

const EMA_ALPHA = 0.3;
const INITIAL_PROBABILITY = 0.5;
const ZPD_LOW = 0.3;
const ZPD_HIGH = 0.7;
const CORRECT_THRESHOLD = 0.5;

@Injectable()
export class MasteryService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Called after any grading (auto or manual) to update KC evidence and mastery.
   */
  async updateMasteryAfterGrading(gradingResultId: string, attemptId: string): Promise<void> {
    // Load the grading result + attempt + question + question KCs
    const gradingResult = await this.prisma.gradingResult.findUnique({
      where: { id: gradingResultId },
    });

    if (!gradingResult) return;

    const attempt = await this.prisma.attempt.findUnique({
      where: { id: attemptId },
      include: {
        question: {
          include: {
            questionKcs: true,
          },
        },
      },
    });

    if (!attempt || !attempt.question.questionKcs.length) return;

    const maxScore = attempt.question.maxScore;
    const fractionalScore = maxScore > 0 ? gradingResult.score / maxScore : 0;
    const isCorrect = fractionalScore >= CORRECT_THRESHOLD;
    const now = new Date();

    // For each KC tagged to this question
    for (const qkc of attempt.question.questionKcs) {
      // 1. Insert KC evidence (append-only)
      await this.prisma.kcEvidence.create({
        data: {
          gradingResultId,
          kcId: qkc.kcId,
          isCorrect,
          score: fractionalScore,
        },
      });

      // 2. Upsert user mastery with EMA
      const existing = await this.prisma.userMastery.findUnique({
        where: {
          userId_kcId: {
            userId: attempt.studentId,
            kcId: qkc.kcId,
          },
        },
      });

      if (existing) {
        const newP = EMA_ALPHA * fractionalScore + (1 - EMA_ALPHA) * existing.probabilityKnown;

        await this.prisma.userMastery.update({
          where: { id: existing.id },
          data: {
            probabilityKnown: newP,
            totalAttempts: { increment: 1 },
            correctAttempts: isCorrect ? { increment: 1 } : existing.correctAttempts,
            lastAttemptAt: now,
          },
        });
      } else {
        const newP = EMA_ALPHA * fractionalScore + (1 - EMA_ALPHA) * INITIAL_PROBABILITY;

        await this.prisma.userMastery.create({
          data: {
            userId: attempt.studentId,
            kcId: qkc.kcId,
            probabilityKnown: newP,
            totalAttempts: 1,
            correctAttempts: isCorrect ? 1 : 0,
            lastAttemptAt: now,
          },
        });
      }
    }
  }

  /**
   * Get mastery for a student, grouped by topic.
   */
  async getMasteryForStudent(studentId: string): Promise<MasteryByTopic[]> {
    const masteries = await this.prisma.userMastery.findMany({
      where: { userId: studentId },
      include: {
        kc: {
          include: {
            topic: {
              include: {
                course: { select: { id: true, title: true } },
              },
            },
          },
        },
      },
      orderBy: { kc: { code: 'asc' } },
    });

    // Group by topic
    const topicMap = new Map<string, MasteryByTopic>();

    for (const m of masteries) {
      const topic = m.kc.topic;
      const key = topic.id;

      if (!topicMap.has(key)) {
        topicMap.set(key, {
          topicId: topic.id,
          topicTitle: topic.title,
          courseId: topic.course.id,
          courseTitle: topic.course.title,
          kcs: [],
        });
      }

      const item: KcMasteryItem = {
        kcId: m.kcId,
        code: m.kc.code,
        label: m.kc.label,
        probabilityKnown: m.probabilityKnown,
        totalAttempts: m.totalAttempts,
        correctAttempts: m.correctAttempts,
        lastAttemptAt: m.lastAttemptAt?.toISOString() ?? null,
      };

      topicMap.get(key)!.kcs.push(item);
    }

    return Array.from(topicMap.values());
  }

  /**
   * Get weakest KCs for a student.
   */
  async getWeakKcs(studentId: string, limit = 5): Promise<KcMasteryItem[]> {
    const masteries = await this.prisma.userMastery.findMany({
      where: {
        userId: studentId,
        totalAttempts: { gt: 0 },
      },
      include: {
        kc: true,
      },
      orderBy: { probabilityKnown: 'asc' },
      take: limit,
    });

    return masteries.map((m) => ({
      kcId: m.kcId,
      code: m.kc.code,
      label: m.kc.label,
      probabilityKnown: m.probabilityKnown,
      totalAttempts: m.totalAttempts,
      correctAttempts: m.correctAttempts,
      lastAttemptAt: m.lastAttemptAt?.toISOString() ?? null,
    }));
  }

  /**
   * Generate a revision worksheet targeting ZPD KCs.
   */
  async generateRevisionWorksheet(studentId: string) {
    // 1. Get ZPD KCs
    let targetMasteries = await this.prisma.userMastery.findMany({
      where: {
        userId: studentId,
        probabilityKnown: { gte: ZPD_LOW, lte: ZPD_HIGH },
        totalAttempts: { gt: 0 },
      },
      include: { kc: true },
      orderBy: { probabilityKnown: 'asc' },
    });

    // Fallback: if no ZPD KCs, take weakest KCs
    if (targetMasteries.length === 0) {
      targetMasteries = await this.prisma.userMastery.findMany({
        where: {
          userId: studentId,
          totalAttempts: { gt: 0 },
        },
        include: { kc: true },
        orderBy: { probabilityKnown: 'asc' },
        take: 5,
      });
    }

    if (targetMasteries.length === 0) {
      throw new NotFoundException('No mastery data found. Complete some assessments first.');
    }

    const targetKcIds = targetMasteries.map((m) => m.kcId);

    // 2. Find questions tagged with those KCs
    const questionKcs = await this.prisma.questionKc.findMany({
      where: { kcId: { in: targetKcIds } },
      include: {
        question: {
          include: {
            topic: {
              include: {
                course: true,
              },
            },
          },
        },
      },
    });

    // Get enrolled course IDs for this student
    const enrollments = await this.prisma.enrollment.findMany({
      where: { studentId },
      select: { courseId: true },
    });
    const enrolledCourseIds = new Set(enrollments.map((e) => e.courseId));

    // Filter to enrolled courses + deduplicate questions
    const questionMap = new Map<string, (typeof questionKcs)[0]['question']>();
    for (const qkc of questionKcs) {
      const q = qkc.question;
      if (q.topic && enrolledCourseIds.has(q.topic.course.id) && !questionMap.has(q.id)) {
        questionMap.set(q.id, q);
      }
    }

    const selectedQuestions = Array.from(questionMap.values()).slice(0, 10);

    if (selectedQuestions.length === 0) {
      throw new NotFoundException(
        'No suitable questions found for revision. Ask your teacher to add more questions.',
      );
    }

    // 3. Pick a course for the assessment (first enrolled course that has matching questions)
    const courseId = selectedQuestions[0]!.topic!.course.id;

    // 4. Create the assessment
    const assessment = await this.prisma.assessment.create({
      data: {
        courseId,
        title: `Revision Worksheet — ${new Date().toLocaleDateString()}`,
        description: 'Auto-generated revision worksheet targeting your weakest knowledge areas.',
        questions: {
          create: selectedQuestions.map((q, index) => ({
            questionId: q.id,
            orderIndex: index,
          })),
        },
      },
      include: {
        questions: {
          orderBy: { orderIndex: 'asc' },
          include: { question: true },
        },
        _count: { select: { questions: true } },
      },
    });

    return assessment;
  }

  // ─── KC CRUD ──────────────────────────────────────────

  async createKc(dto: CreateKc) {
    // Verify topic exists
    const topic = await this.prisma.topic.findUnique({
      where: { id: dto.topicId },
    });

    if (!topic) {
      throw new NotFoundException(`Topic ${dto.topicId} not found`);
    }

    return this.prisma.knowledgeComponent.create({
      data: {
        topicId: dto.topicId,
        code: dto.code,
        label: dto.label,
        description: dto.description,
      },
    });
  }

  async findKcsByTopic(topicId: string) {
    return this.prisma.knowledgeComponent.findMany({
      where: { topicId },
      orderBy: { code: 'asc' },
    });
  }

  async deleteKc(id: string) {
    const kc = await this.prisma.knowledgeComponent.findUnique({
      where: { id },
    });

    if (!kc) {
      throw new NotFoundException(`KC ${id} not found`);
    }

    await this.prisma.knowledgeComponent.delete({ where: { id } });
    return { deleted: true };
  }
}
