import { z } from 'zod';

/**
 * DTO for generating elaboration questions
 */
export const GenerateElaborationSchema = z.object({
  selectedText: z.string().min(20, 'Selected text must be at least 20 characters'),
  courseId: z.string().uuid(),
  contentId: z.string().uuid(),
  questionCount: z
    .number()
    .int()
    .min(2, 'Must generate at least 2 questions')
    .max(8, 'Cannot generate more than 8 questions')
    .default(4),
});

export type GenerateElaborationDto = z.infer<typeof GenerateElaborationSchema>;

/**
 * DTO for submitting an elaboration for evaluation
 */
export const SubmitElaborationSchema = z.object({
  questionIndex: z.number().int().min(0),
  elaboration: z.string().min(50, 'Elaboration must be at least 50 characters'),
});

export type SubmitElaborationDto = z.infer<typeof SubmitElaborationSchema>;

/**
 * Question structure for frontend (includes keyPoints for evaluation)
 */
export interface ElaborationQuestionForStudent {
  question: string;
  type: 'why' | 'how';
  keyPoints: string[]; // Needed for evaluation call
}

/**
 * Response from generate endpoint
 */
export interface GenerateElaborationResponse {
  interventionId: string;
  sessionId: string;
  questions: ElaborationQuestionForStudent[];
  sourceText: string;
}

/**
 * Evaluation result from evaluate endpoint
 */
export interface ElaborationEvaluationResult {
  questionIndex: number;
  rating: 'Strong' | 'Developing' | 'Needs Improvement';
  addressedPoints: string[];
  missedPoints: string[];
  feedback: string;
  modelElaboration: string;
}

/**
 * User elaboration entry stored in the session
 */
export interface UserElaborationEntry {
  questionIndex: number;
  elaboration: string;
  rating: 'Strong' | 'Developing' | 'Needs Improvement';
  feedback: string;
  addressedPoints: string[];
  missedPoints: string[];
  modelElaboration: string;
  submittedAt: string;
}

/**
 * Summary after completing the session
 */
export interface ElaborationSummary {
  sessionId: string;
  totalQuestions: number;
  completed: boolean;
  ratings: {
    strong: number;
    developing: number;
    needsImprovement: number;
  };
  overallMessage: string;
  elaborations: UserElaborationEntry[];
}

/**
 * Full session result
 */
export interface ElaborationSessionResult {
  sessionId: string;
  interventionId: string;
  questions: ElaborationQuestionForStudent[];
  sourceText: string;
  elaborations: UserElaborationEntry[];
  completed: boolean;
}
