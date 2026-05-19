export interface GenerateCardsDto {
  selectedText: string; // min 20 chars
  courseId: string;
  contentId?: string;
  pageType?: string;
  cardCount?: number; // default 5, min 1, max 15
}

export interface ReviewCardDto {
  quality: 'again' | 'hard' | 'good' | 'easy';
}
