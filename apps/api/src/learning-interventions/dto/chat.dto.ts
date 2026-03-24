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
}
