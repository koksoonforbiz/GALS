import { z } from 'zod';

/**
 * DTO for generating flashcards
 */
export const GenerateCardsSchema = z.object({
  selectedText: z.string().min(20, 'Selected text must be at least 20 characters'),
  courseId: z.string().uuid(),
  contentId: z.string().uuid(),
  cardCount: z.number().int().min(1).max(15).default(5),
});

export type GenerateCardsDto = z.infer<typeof GenerateCardsSchema>;

/**
 * DTO for reviewing a card
 */
export const ReviewCardSchema = z.object({
  quality: z.enum(['again', 'hard', 'good', 'easy']),
});

export type ReviewCardDto = z.infer<typeof ReviewCardSchema>;

/**
 * Flashcard structure
 */
export interface Flashcard {
  id: string;
  front: string;
  back: string;
}

/**
 * Response from generate endpoint
 */
export interface CardGenerationResult {
  interventionId: string;
  cards: Flashcard[];
  totalCreated: number;
}

/**
 * Card for review queue (includes scheduling info)
 */
export interface DueCard {
  id: string;
  front: string;
  back: string;
  interval: number;
  repetitions: number;
  courseId: string;
  courseName?: string;
}

/**
 * Response from due cards endpoint
 */
export interface DueCardsResult {
  dueCards: DueCard[];
  totalDue: number;
}

/**
 * Response from review endpoint
 */
export interface ReviewResult {
  nextReviewAt: string;
  interval: number;
  ease: number;
}

/**
 * Card statistics
 */
export interface CardStats {
  totalCards: number;
  dueToday: number;
  dueThisWeek: number;
  averageEase: number;
  longestStreak: number;
  cardsByStage: {
    new: number; // repetitions === 0
    learning: number; // repetitions 1-2
    mature: number; // repetitions >= 3
  };
}

/**
 * Preview intervals for rating buttons
 */
export interface PreviewIntervals {
  again: number;
  hard: number;
  good: number;
  easy: number;
}
