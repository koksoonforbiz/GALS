/** Generate suggested questions for the student to ask */
export interface GenerateSuggestionsDto {
  selectedText: string; // min 20 chars
  courseId: string;
  contentId?: string;
  pageType?: string;
  questionCount?: number; // default 6, min 3, max 10
}

/** Student asks a question to the chatbot tutor */
export interface AskQuestionDto {
  question: string; // min 5 chars
  conversationHistory: Array<{ role: 'user' | 'assistant'; content: string }>;
}
