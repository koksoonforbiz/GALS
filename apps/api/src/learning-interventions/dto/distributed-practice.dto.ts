export interface GenerateCardsDto {
  /** Either ≥20 chars or empty — empty triggers RAG-over-course fallback. */
  selectedText: string;
  courseId: string;
  contentId?: string;
  pageType?: string;
  /** Optional topic hint for the RAG fallback. */
  topic?: string;
  cardCount?: number; // default 5, min 1, max 15
}

export interface ReviewCardDto {
  quality: 'again' | 'hard' | 'good' | 'easy';
}
