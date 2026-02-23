import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';

interface Flashcard {
  id: string;
  front: string;
  back: string;
}

interface CardGenerationResult {
  interventionId: string;
  cards: Flashcard[];
  totalCreated: number;
}

interface DistributedPracticeGenerateViewProps {
  selectedText: string;
  courseId: string;
  contentId: string;
  pageType?: string; // "lesson", "quiz", "reading", etc.
  onComplete: () => void;
  onBack: () => void;
}

type ViewState = 'loading' | 'preview' | 'error';

export function DistributedPracticeGenerateView({
  selectedText,
  courseId,
  contentId,
  pageType,
  onComplete,
  onBack,
}: DistributedPracticeGenerateViewProps) {
  void pageType; // Reserved for future context-aware behavior
  const navigate = useNavigate();
  const [state, setState] = useState<ViewState>('loading');
  const [cards, setCards] = useState<Flashcard[]>([]);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [deletedCardIds, setDeletedCardIds] = useState<Set<string>>(new Set());

  // Start generation on mount
  useState(() => {
    generateCards();
  });

  async function generateCards() {
    setState('loading');
    setError(null);

    try {
      const result = await api.post<CardGenerationResult>(
        '/learning-interventions/distributed-practice/generate',
        {
          selectedText,
          courseId,
          contentId,
          cardCount: 5,
        },
      );

      setCards(result.cards);
      setState('preview');
    } catch (err: any) {
      setError(err.message || 'Failed to generate flashcards');
      setState('error');
    }
  }

  async function handleDeleteCard(cardId: string) {
    try {
      await api.delete(`/learning-interventions/distributed-practice/cards/${cardId}`);
      setDeletedCardIds((prev) => new Set([...prev, cardId]));

      // If we deleted the current card, adjust the index
      const visibleCards = cards.filter((c) => !deletedCardIds.has(c.id) && c.id !== cardId);
      if (currentCardIndex >= visibleCards.length && visibleCards.length > 0) {
        setCurrentCardIndex(visibleCards.length - 1);
      }
    } catch (err: any) {
      console.error('Failed to delete card:', err);
    }
  }

  function handleFlip() {
    setFlipped(!flipped);
  }

  function handlePrevCard() {
    setFlipped(false);
    setCurrentCardIndex((prev) => Math.max(0, prev - 1));
  }

  function handleNextCard() {
    setFlipped(false);
    const visibleCards = cards.filter((c) => !deletedCardIds.has(c.id));
    setCurrentCardIndex((prev) => Math.min(visibleCards.length - 1, prev + 1));
  }

  function handleGoToReviewQueue() {
    navigate('/student/review-queue');
  }

  // Get visible cards (excluding deleted)
  const visibleCards = cards.filter((c) => !deletedCardIds.has(c.id));
  const currentCard = visibleCards[currentCardIndex];

  // ─── Back to Chat Header ─────────────────────────────────
  const BackHeader = () => (
    <div className="flex items-center gap-2 pb-3 mb-4 border-b border-gray-200">
      <button
        onClick={onBack}
        className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to chat
      </button>
      <span className="text-sm font-medium text-gray-700">Distributed Practice</span>
    </div>
  );

  // Loading state
  if (state === 'loading') {
    return (
      <div className="w-full">
        <BackHeader />
        <div className="flex flex-col items-center justify-center py-8">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-600 text-sm text-center mt-4">Creating flashcards...</p>
        </div>
      </div>
    );
  }

  // Error state
  if (state === 'error') {
    return (
      <div className="w-full">
        <BackHeader />
        <div className="flex flex-col items-center justify-center py-8">
          <div className="text-red-500 text-4xl mb-4">!</div>
          <p className="text-red-600 text-center text-sm mb-4">{error}</p>
          <button
            onClick={generateCards}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // Preview state - show generated cards
  return (
    <div className="w-full">
      <BackHeader />
      <div className="space-y-4">
        {/* Success header */}
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center">
            <svg
              className="w-4 h-4 text-green-600"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M5 13l4 4L19 7"
              />
            </svg>
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">
              {visibleCards.length} card{visibleCards.length !== 1 ? 's' : ''} created!
            </h3>
            <p className="text-xs text-gray-500">First review scheduled for tomorrow.</p>
          </div>
        </div>

        {/* Card preview carousel */}
        {visibleCards.length > 0 && currentCard && (
          <div>
            {/* Card counter */}
            <div className="text-center text-xs text-gray-500 mb-2">
              Card {currentCardIndex + 1} of {visibleCards.length}
            </div>

            {/* Flip card */}
            <div className="perspective-1000 mb-3">
              <div
                className={`relative w-full h-36 cursor-pointer transition-transform duration-500 transform-style-3d ${
                  flipped ? 'rotate-y-180' : ''
                }`}
                onClick={handleFlip}
                style={{
                  transformStyle: 'preserve-3d',
                  transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                }}
              >
                {/* Front */}
                <div
                  className="absolute inset-0 bg-white border border-gray-200 rounded-lg shadow-sm p-4 flex flex-col items-center justify-center backface-hidden"
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  <p className="text-xs uppercase tracking-wide text-gray-400 mb-1">Question</p>
                  <p className="text-sm text-gray-900 text-center font-medium line-clamp-3">
                    {currentCard.front}
                  </p>
                  <p className="text-xs text-gray-400 mt-2">Tap to flip</p>
                </div>

                {/* Back */}
                <div
                  className="absolute inset-0 bg-blue-50 border border-blue-200 rounded-lg shadow-sm p-4 flex flex-col items-center justify-center"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <p className="text-xs uppercase tracking-wide text-blue-400 mb-1">Answer</p>
                  <p className="text-sm text-gray-900 text-center line-clamp-3">
                    {currentCard.back}
                  </p>
                  <p className="text-xs text-blue-400 mt-2">Tap to flip back</p>
                </div>
              </div>
            </div>

            {/* Navigation and delete */}
            <div className="flex items-center justify-between">
              <button
                onClick={handlePrevCard}
                disabled={currentCardIndex === 0}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M15 19l-7-7 7-7"
                  />
                </svg>
              </button>

              <button
                onClick={() => handleDeleteCard(currentCard.id)}
                className="px-2 py-1 text-xs text-red-600 hover:text-red-700 hover:bg-red-50 rounded-lg flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                  />
                </svg>
                Delete
              </button>

              <button
                onClick={handleNextCard}
                disabled={currentCardIndex >= visibleCards.length - 1}
                className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M9 5l7 7-7 7"
                  />
                </svg>
              </button>
            </div>
          </div>
        )}

        {/* Empty state if all cards deleted */}
        {visibleCards.length === 0 && (
          <div className="text-center py-6 text-gray-500 text-sm">
            <p>All cards have been deleted.</p>
          </div>
        )}

        {/* Info text */}
        <div className="bg-blue-50 border border-blue-100 rounded-lg p-3">
          <p className="text-xs text-blue-700">
            Cards appear in your Review Queue with spaced repetition for long-term retention.
          </p>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <button
            onClick={handleGoToReviewQueue}
            className="flex-1 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
          >
            Review Queue
          </button>
          <button
            onClick={onComplete}
            className="flex-1 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
