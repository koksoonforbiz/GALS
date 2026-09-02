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
 *  Step button offers a Coding Steps (DBox) / Reading Steps choice, or
 *  goes straight to the regular reading-comprehension flow. Pure
 *  classification — see CodePracticeService.isCodingCourse. */
export interface StepwiseCourseCheckDto {
  courseId: string;
}

/** Generate the coding exercise for a Coding Steps (DBox) session —
 *  called once the student picks Coding Steps after StepwiseCourseCheckDto
 *  said the course is coding-related. */
export interface GenerateStepwiseCodeQuestionDto {
  courseId: string;
  /** Currently highlighted passage, if any — steers the generated
   *  question toward it, same as the inline chat code-question flow. */
  selectedText?: string;
}
