/** Generate stepwise learning steps from selected text */
export interface GenerateStepwiseDto {
  /** Either ≥20 chars or empty — empty triggers RAG-over-course fallback. */
  selectedText: string;
  courseId: string;
  contentId?: string;
  pageType?: string;
  /** Optional topic hint for the RAG fallback. */
  topic?: string;
  documentId?: string;
  pageNumber?: number;
}

/** Submit a comprehension check response */
export interface SubmitStepCheckDto {
  stepNumber: number;
  userResponse: string; // min 10 chars
}

/** Ask "is this course about programming?" before deciding whether the
 *  Step button should launch DBox (code decomposition) or the regular
 *  reading-comprehension stepwise flow. See
 *  CodePracticeService.checkCodingCourseAndGenerate — the classification
 *  and (if applicable) question generation happen in one LLM call. */
export interface StepwiseCourseCheckDto {
  courseId: string;
  /** Currently highlighted passage, if any — steers the generated
   *  question toward it, same as the inline chat code-question flow. */
  selectedText?: string;
}
