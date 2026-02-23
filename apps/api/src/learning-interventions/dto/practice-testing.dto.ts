import { z } from 'zod';

/**
 * DTO for generating a practice test
 */
export const GeneratePracticeTestSchema = z.object({
  selectedText: z.string().min(20, 'Selected text must be at least 20 characters'),
  courseId: z.string().uuid(),
  contentId: z.string().uuid(),
  questionCount: z
    .number()
    .int()
    .min(1, 'Must generate at least 1 question')
    .max(10, 'Cannot generate more than 10 questions')
    .default(5),
});

export type GeneratePracticeTestDto = z.infer<typeof GeneratePracticeTestSchema>;

/**
 * DTO for submitting practice test answers
 */
export const SubmitPracticeTestAnswersSchema = z.object({
  answers: z.array(
    z.object({
      questionIndex: z.number().int().min(0),
      answer: z.string().min(1, 'Answer cannot be empty'),
    }),
  ),
});

export type SubmitPracticeTestAnswersDto = z.infer<typeof SubmitPracticeTestAnswersSchema>;

/**
 * Question structure for frontend (without correct answer)
 */
export interface PracticeTestQuestionForStudent {
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[];
}

/**
 * Full question structure (with correct answer, for grading)
 */
export interface PracticeTestQuestionFull {
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[];
  correctAnswer: string;
  explanation: string;
  keywords?: string[];
}

/**
 * Response after generating a practice test
 */
export interface GeneratePracticeTestResponse {
  interventionId: string;
  practiceTestId: string;
  questions: PracticeTestQuestionForStudent[];
}

/**
 * Answer result after grading
 */
export interface AnswerResult {
  questionIndex: number;
  userAnswer: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
}

/**
 * Response after submitting answers
 */
export interface SubmitAnswersResponse {
  practiceTestId: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  results: AnswerResult[];
}

/**
 * Practice test with full details (for results view)
 */
export interface PracticeTestResult {
  id: string;
  interventionId: string;
  questions: PracticeTestQuestionFull[];
  userAnswers: Array<{
    questionIndex: number;
    answer: string;
    isCorrect: boolean;
    submittedAt: string;
  }> | null;
  score: number | null;
  completedAt: string | null;
  createdAt: string;
}
