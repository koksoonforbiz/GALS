/** Generate suggested questions for the student to ask */
export interface GenerateSuggestionsDto {
  /** Either ≥20 chars or empty — empty triggers RAG-over-course fallback. */
  selectedText: string;
  courseId: string;
  contentId?: string;
  pageType?: string;
  /** Optional topic hint for the RAG fallback. */
  topic?: string;
  questionCount?: number; // default 6, min 3, max 10
  documentId?: string;
  pageNumber?: number;
}

/** Student asks a question to the chatbot tutor */
export interface AskQuestionDto {
  question: string; // min 5 chars
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
  /**
   * Bug 3 (2026-06-12): Elab sessions previously froze the slide
   * context at session-start because askQuestion() only read
   * sessionData.selectedText (written once in generateSuggestions).
   * The client now optionally re-sends the CURRENT page / selection /
   * content with every turn so the backend can re-resolve the
   * grounded text. Absent values keep the previous (session-start)
   * behavior, so existing clients keep working.
   */
  selectedText?: string;
  contentId?: string;
  currentPage?: number;
  courseId?: string;
}
