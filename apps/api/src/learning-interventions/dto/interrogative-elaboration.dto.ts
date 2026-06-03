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
}

/** Student asks a question to the chatbot tutor */
export interface AskQuestionDto {
  question: string; // min 5 chars
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}
