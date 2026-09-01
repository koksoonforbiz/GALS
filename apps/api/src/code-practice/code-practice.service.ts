import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../rag/llm.service';
import {
  buildCodePracticeSystemPrompt,
  buildCodePracticeUserPrompt,
  buildCodingCourseCheckSystemPrompt,
  buildCodingCourseCheckUserPrompt,
} from './prompts/code-practice.prompt';

export type CodingCourseCheckResult =
  | { isCoding: false }
  | ({ isCoding: true } & CodePracticeQuestion);

export interface CodePracticeQuestion {
  question: string;
  starterCode: string;
  language: string;
}

/**
 * Standalone question generator for inline chat coding exercises.
 *
 * Deliberately independent of `learning-interventions`'s
 * PracticeQuestion/generatePracticeTest — no test cases, no grading, no
 * public HTTP surface. Called in-process only, from
 * LearningInterventionsService.chat() when it detects a coding-practice
 * request in the standard-mode chatbot.
 */
@Injectable()
export class CodePracticeService {
  private readonly logger = new Logger(CodePracticeService.name);

  constructor(private readonly llmService: LlmService) {}

  async generateQuestion(
    teacherId: string,
    courseId: string,
    courseTitle: string,
    options?: { groundingText?: string; highlightedText?: string },
  ): Promise<CodePracticeQuestion> {
    const systemPrompt = buildCodePracticeSystemPrompt();
    const userPrompt = buildCodePracticeUserPrompt({
      courseTitle,
      groundingText: options?.groundingText,
      highlightedText: options?.highlightedText,
    });

    const result = await this.llmService.callLlmStructured(
      teacherId,
      {
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        jsonMode: true,
      },
      { feature: 'code_practice_generation', courseId },
    );

    const parsed = this.parseQuestion(result.content);
    if (!parsed) {
      // Template fallback so a malformed LLM response never breaks the
      // chat turn — the student still gets something runnable.
      this.logger.warn('code_practice_generation: falling back to template question');
      return {
        question: 'Write a function `add(a, b)` that returns the sum of two numbers.',
        starterCode: 'def add(a, b):\n    """Return the sum of a and b."""\n    pass\n',
        language: 'python',
      };
    }
    return parsed;
  }

  /**
   * Classifies whether a course is programming-focused and, in the same
   * LLM call, generates a coding exercise if it is — used to decide
   * whether the "Step" button should launch DBox (code decomposition) or
   * the regular reading-comprehension stepwise flow. On any parse
   * failure this defaults to `{isCoding: false}` rather than guessing —
   * a missed DBox launch is a minor inconvenience, but forcing a coding
   * flow onto a non-coding course would be a much worse one.
   */
  async checkCodingCourseAndGenerate(
    teacherId: string,
    courseId: string,
    courseTitle: string,
    options?: { courseDescription?: string; highlightedText?: string },
  ): Promise<CodingCourseCheckResult> {
    const systemPrompt = buildCodingCourseCheckSystemPrompt();
    const userPrompt = buildCodingCourseCheckUserPrompt({
      courseTitle,
      courseDescription: options?.courseDescription,
      highlightedText: options?.highlightedText,
    });

    const result = await this.llmService.callLlmStructured(
      teacherId,
      {
        systemPrompt,
        messages: [{ role: 'user', content: userPrompt }],
        jsonMode: true,
      },
      { feature: 'code_practice_course_check', courseId },
    );

    return this.parseCourseCheck(result.content) ?? { isCoding: false };
  }

  private parseCourseCheck(raw: string): CodingCourseCheckResult | null {
    let cleaned = raw.trim();
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) cleaned = fenced[1].trim();

    try {
      const data = JSON.parse(cleaned) as Partial<CodePracticeQuestion> & { isCoding?: unknown };
      if (data.isCoding === false) return { isCoding: false };
      if (
        data.isCoding === true &&
        typeof data.question === 'string' &&
        data.question.trim().length > 0 &&
        typeof data.starterCode === 'string' &&
        data.starterCode.trim().length > 0
      ) {
        return {
          isCoding: true,
          question: data.question.trim(),
          starterCode: data.starterCode,
          language: typeof data.language === 'string' && data.language ? data.language : 'python',
        };
      }
    } catch {
      // fall through to null
    }
    return null;
  }

  private parseQuestion(raw: string): CodePracticeQuestion | null {
    let cleaned = raw.trim();
    const fenced = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced?.[1]) cleaned = fenced[1].trim();

    try {
      const data = JSON.parse(cleaned) as Partial<CodePracticeQuestion>;
      if (
        typeof data.question === 'string' &&
        data.question.trim().length > 0 &&
        typeof data.starterCode === 'string' &&
        data.starterCode.trim().length > 0
      ) {
        return {
          question: data.question.trim(),
          starterCode: data.starterCode,
          language: typeof data.language === 'string' && data.language ? data.language : 'python',
        };
      }
    } catch {
      // fall through to null
    }
    return null;
  }
}
