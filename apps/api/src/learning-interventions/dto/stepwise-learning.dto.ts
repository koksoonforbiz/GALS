import { z } from 'zod';

/**
 * DTO for generating stepwise learning content
 */
export const GenerateStepwiseSchema = z.object({
  selectedText: z.string().min(20, 'Selected text must be at least 20 characters'),
  courseId: z.string().uuid(),
  contentId: z.string().uuid(),
});

export type GenerateStepwiseDto = z.infer<typeof GenerateStepwiseSchema>;

/**
 * DTO for submitting a comprehension check response
 */
export const SubmitStepCheckSchema = z.object({
  stepNumber: z.number().int().min(1),
  userResponse: z.string().min(10, 'Response must be at least 10 characters'),
});

export type SubmitStepCheckDto = z.infer<typeof SubmitStepCheckSchema>;

/**
 * Comprehension check structure
 */
export interface ComprehensionCheck {
  question: string;
  hint: string;
  sampleAnswer: string;
}

/**
 * Learning step structure
 */
export interface LearningStep {
  stepNumber: number;
  title: string;
  content: string;
  comprehensionCheck: ComprehensionCheck;
}

/**
 * User response entry stored in the session
 */
export interface UserStepResponse {
  stepNumber: number;
  response: string;
  feedback: string;
  isCorrect: boolean;
  submittedAt: string;
}

/**
 * Response from generate endpoint
 */
export interface GenerateStepwiseResponse {
  interventionId: string;
  sessionId: string;
  steps: LearningStep[];
  summary: string;
  totalSteps: number;
  currentStep: number;
}

/**
 * Response from check endpoint
 */
export interface StepCheckResult {
  isCorrect: boolean;
  feedback: string;
  encouragement: string;
}

/**
 * Full session result (for get/resume)
 */
export interface StepwiseSessionResult {
  sessionId: string;
  interventionId: string;
  steps: LearningStep[];
  summary: string;
  totalSteps: number;
  currentStep: number;
  userResponses: UserStepResponse[];
  completed: boolean;
  sourceText: string;
}

/**
 * Summary after completing the session
 */
export interface StepwiseSummary {
  sessionId: string;
  totalSteps: number;
  correctOnFirstTry: number;
  completed: boolean;
  summary: string;
  userResponses: UserStepResponse[];
}
