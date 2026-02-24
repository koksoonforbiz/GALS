export type ChatbotMode =
  | 'chat'
  | 'practice-testing'
  | 'distributed-practice'
  | 'stepwise-learning'
  | 'interrogative-elaboration'
  | 'review-tab';

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export type InterventionType =
  | 'PRACTICE_TESTING'
  | 'DISTRIBUTED_PRACTICE'
  | 'STEPWISE_LEARNING'
  | 'INTERROGATIVE_ELABORATION';

export interface SavedReviewListItem {
  id: string;
  interventionId: string;
  interventionType: InterventionType;
  courseId: string;
  contentId: string | null;
  pageType: string | null;
  title: string;
  selectedText: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SavedReviewDetail extends SavedReviewListItem {
  savedData: Record<string, unknown>;
}

export interface SavedReviewsResponse {
  items: SavedReviewListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface SaveForReviewInput {
  interventionId: string;
  interventionType: InterventionType;
  title: string;
  selectedText: string;
  savedData: Record<string, unknown>;
}
