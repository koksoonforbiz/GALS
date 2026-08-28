/**
 * Start a new DBox session. If `question`/`starterCode` are omitted, a
 * fresh problem is generated the same way the inline chat code-question
 * widget does (via CodePracticeService) — this lets the Playground start
 * a session either from an already-active chat-generated question or
 * completely freeform.
 */
export interface GenerateDecompositionDto {
  courseId: string;
  contentId?: string;
  pageType?: string;
  question?: string;
  starterCode?: string;
  language?: string;
}
