/** Generate stepwise learning steps from selected text */
export interface GenerateStepwiseDto {
  selectedText: string; // min 20 chars
  courseId: string;
  contentId?: string;
  pageType?: string;
}

/** Submit a comprehension check response */
export interface SubmitStepCheckDto {
  stepNumber: number;
  userResponse: string; // min 10 chars
}
