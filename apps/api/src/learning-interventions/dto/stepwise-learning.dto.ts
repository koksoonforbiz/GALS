/** Generate stepwise learning steps from selected text */
export interface GenerateStepwiseDto {
  /** Either ≥20 chars or empty — empty triggers RAG-over-course fallback. */
  selectedText: string;
  courseId: string;
  contentId?: string;
  pageType?: string;
  /** Optional topic hint for the RAG fallback. */
  topic?: string;
}

/** Submit a comprehension check response */
export interface SubmitStepCheckDto {
  stepNumber: number;
  userResponse: string; // min 10 chars
}
