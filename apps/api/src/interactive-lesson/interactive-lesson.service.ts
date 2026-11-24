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
  type CheckpointFeedback,
  type CheckpointVerdict,
  type LessonDocument,
  type LessonSlideState,
  type UserRole,
} from '@ats/shared';
import { PrismaService } from '../prisma';
import { TextConsentService } from '../governance/text-consent.service';
import { CourseGateService } from '../course-gates/course-gate.service';
import { LlmService } from '../rag/llm.service';

const plain = (h: unknown): string =>
  typeof h === 'string'
    ? h
        .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
        .replace(/<[^>]+>/g, ' ')
        .replace(/&nbsp;/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/\s+/g, ' ')
        .trim()
    : '';

const VERDICTS: CheckpointVerdict[] = ['on_track', 'partly', 'off_track'];

export interface LessonViewer {
  id: string;
  role: UserRole;
}

@Injectable()
export class InteractiveLessonService {
  constructor(
    private readonly prisma: PrismaService,
    @Optional() private readonly consent?: TextConsentService,
    @Optional() private readonly gates?: CourseGateService,
    @Optional() private readonly llm?: LlmService,
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
      // Course gates (e.g. the pre-course questionnaire and puzzles) lock later modules.
      await this.gates?.assertModuleOpen(viewer.id, courseId, item.moduleId);
    } else if (viewer.role === 'teacher' && item.module.course.teacherId !== viewer.id) {
      throw new ForbiddenException('You can only view lessons in your own courses');
    }
    return {
      item,
      courseId,
      teacherId: item.module.course.teacherId,
      lesson: item.lessonJson as unknown as LessonDocument,
    };
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

  /**
   * AI feedback on a "Checkpoint" prediction (predict slide): compares the
   * student's answer with the slide's own reveal text and returns a short
   * verdict + feedback, stored in the slide state as `aiFeedback`. Billed to
   * the course teacher's model like the Prompt Lab. Returns null when the
   * course has no LLM configured (template provider) — the slide then shows
   * the reveal only, as before.
   */
  async checkpointFeedback(
    itemId: string,
    slideKey: string,
    studentId: string,
    answer: string,
    sessionId?: string,
  ): Promise<CheckpointFeedback | null> {
    const { courseId, teacherId, lesson } = await this.loadAuthorized(itemId, {
      id: studentId,
      role: 'student',
    });
    const slide = lesson.slides.find((s) => s.key === slideKey);
    if (!slide) throw new BadRequestException(`Unknown slide "${slideKey}"`);
    if (slide.t !== 'predict') throw new BadRequestException('Feedback is only for checkpoints');
    if (!this.llm) return null;

    const systemPrompt = [
      'You are a supportive tutor in a university course on prompt engineering.',
      'A student made a prediction at a checkpoint before reading the explanation.',
      'Compare their prediction with the explanation. Judge the reasoning, not the wording.',
      'Reply ONLY with JSON: {"verdict": "on_track" | "partly" | "off_track", "feedback": string}.',
      'feedback: 2-3 short sentences, second person, plain English. Say what they got right,',
      'then the one idea they missed or should refine. Do not repeat the whole explanation.',
      'If the answer is off-topic or has no reasoning, use "off_track" and say so kindly.',
    ].join(' ');
    const userPrompt = [
      `Checkpoint question:\n${plain(slide.prompt)}`,
      `Explanation (the reference):\n${plain(slide.reveal)}`,
      `Student's prediction:\n${answer.trim()}`,
    ].join('\n\n');

    const result = await this.llm.callLlmStructured(
      teacherId,
      {
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        jsonMode: true,
        maxTokens: 300,
        temperature: 0.2,
      },
      { feature: 'checkpoint_feedback', courseId, triggeredByUserId: studentId },
    );
    if (!result.provider || result.provider === 'template') return null;

    let parsed: { verdict?: unknown; feedback?: unknown } = {};
    try {
      const m = /\{[\s\S]*\}/.exec(result.content);
      parsed = m ? (JSON.parse(m[0]) as typeof parsed) : {};
    } catch {
      parsed = {};
    }
    const feedback =
      typeof parsed.feedback === 'string' ? parsed.feedback.trim().slice(0, 800) : '';
    if (!feedback) return null;
    const verdict = VERDICTS.includes(parsed.verdict as CheckpointVerdict)
      ? (parsed.verdict as CheckpointVerdict)
      : 'partly';
    const out: CheckpointFeedback = {
      verdict,
      feedback,
      at: new Date().toISOString(),
      model: result.model,
    };

    // Keep it with the slide so it survives a reload (merged, not replaced).
    const where = {
      studentId_moduleItemId_slideKey: { studentId, moduleItemId: itemId, slideKey },
    };
    const row = await this.prisma.lessonSlideState.findUnique({ where, select: { state: true } });
    const prev = (row?.state as unknown as LessonSlideState | null) ?? { fields: {} };
    const next = {
      ...prev,
      fields: { ...(prev.fields ?? {}), aiFeedback: out },
    } as unknown as Prisma.InputJsonValue;
    await this.prisma.lessonSlideState.upsert({
      where,
      create: {
        studentId,
        moduleItemId: itemId,
        slideKey,
        state: next,
        lastSessionId: sessionId ?? null,
      },
      update: { state: next, lastSessionId: sessionId ?? null },
    });
    return out;
  }
}
