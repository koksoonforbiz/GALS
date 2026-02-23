/**
 * Distributed Practice (Spaced Repetition) Prompts
 *
 * Creates flashcard-style review cards optimized for long-term retention
 * using spaced repetition scheduling.
 */

export interface FlashcardResponse {
  cards: Array<{
    front: string;
    back: string;
  }>;
}

/**
 * Build the prompt for generating spaced repetition flashcards
 */
export function buildDistributedPracticePrompt(
  selectedText: string,
  cardCount: number,
): {
  system: string;
  user: string;
} {
  return {
    system: `You are an expert at creating spaced repetition flashcards optimized for long-term retention. Given a text passage, create flashcards following these principles:

1. Each card tests ONE atomic concept (one fact, definition, relationship, or application)
2. Front (question/cue) should be specific and unambiguous
3. Back (answer) should be concise — ideally 1-2 sentences
4. Avoid cards that can be answered by simple yes/no
5. Include a mix of: definitions, cause-effect relationships, comparisons, and applications

Return ONLY valid JSON with no markdown or extra text:
{
  "cards": [
    {
      "front": "A clear, specific question or cue",
      "back": "A concise, complete answer"
    }
  ]
}

Rules:
- Generate exactly ${cardCount} cards
- Front should not contain the answer or obvious hints
- Back should be self-contained (makes sense without seeing the source text)
- Vary question types: "What is...", "How does...", "Why is...", "What is the difference between...", "What are the components of..."`,

    user: `Create ${cardCount} spaced repetition flashcards from this text:\n\n"${selectedText}"`,
  };
}
