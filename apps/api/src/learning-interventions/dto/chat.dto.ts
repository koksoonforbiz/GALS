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
}
