export interface ChatMessageDto {
  role: 'user' | 'assistant';
  content: string;
}

export interface ChatRequestDto {
  message: string;
  conversationHistory: ChatMessageDto[];
  courseId: string;
  pageType?: string;
  contentTitle?: string;
  selectedText?: string;
  /**
   * Id of the module item the student is currently on. Lets the backend
   * find a matching teacher source PDF for standard-mode courses and
   * ground the reply on its contents when no text is selected.
   */
  contentId?: string;
  /**
   * 1-based page number the student is currently reading inside a PDF
   * module item. When set together with `contentId`, the backend
   * narrows the grounded PDF text to a small window around this page
   * (configurable via `RAG_PAGE_WINDOW`, default 2) so "what is this
   * slide about?" answers about the visible slide instead of the
   * whole document. Optional — clients that don't track page state
   * (e.g. PAGE-type lessons) leave this undefined and the backend
   * falls back to the full PDF text.
   */
  currentPage?: number;
}
