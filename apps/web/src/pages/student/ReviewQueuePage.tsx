import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

interface DueCard {
  id: string;
  front: string;
  back: string;
  interval: number;
  repetitions: number;
  courseId: string;
  courseName?: string;
}

interface DueCardsResult {
  dueCards: DueCard[];
  totalDue: number;
}

interface CardStats {
  totalCards: number;
  dueToday: number;
  dueThisWeek: number;
  averageEase: number;
  longestStreak: number;
  cardsByStage: {
    new: number;
    learning: number;
    mature: number;
  };
}

interface ReviewResult {
  nextReviewAt: string;
  interval: number;
  ease: number;
}

type QualityRating = 'again' | 'hard' | 'good' | 'easy';

interface ReviewSessionState {
  cardsReviewed: number;
  ratings: Record<QualityRating, number>;
}

export function ReviewQueuePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<CardStats | null>(null);
  const [dueCards, setDueCards] = useState<DueCard[]>([]);
  const [totalDue, setTotalDue] = useState(0);
  const [currentCardIndex, setCurrentCardIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);
  const [sessionComplete, setSessionComplete] = useState(false);
  const [sessionState, setSessionState] = useState<ReviewSessionState>({
    cardsReviewed: 0,
    ratings: { again: 0, hard: 0, good: 0, easy: 0 },
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadData = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);

      const [statsResult, cardsResult] = await Promise.all([
        api.get<CardStats>('/learning-interventions/distributed-practice/stats'),
        api.get<DueCardsResult>('/learning-interventions/distributed-practice/due?limit=20'),
      ]);

      setStats(statsResult);
      setDueCards(cardsResult.dueCards);
      setTotalDue(cardsResult.totalDue);
    } catch (err: any) {
      setError(err.message || 'Failed to load review data');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
  }, [loadData]);

  async function handleRating(rating: QualityRating) {
    const currentCard = dueCards[currentCardIndex];
    if (!currentCard || submitting) return;

    setSubmitting(true);

    try {
      await api.patch<ReviewResult>(
        `/learning-interventions/distributed-practice/cards/${currentCard.id}/review`,
        { quality: rating },
      );

      // Update session state
      setSessionState((prev) => ({
        cardsReviewed: prev.cardsReviewed + 1,
        ratings: {
          ...prev.ratings,
          [rating]: prev.ratings[rating] + 1,
        },
      }));

      // Move to next card or complete session
      if (currentCardIndex >= dueCards.length - 1) {
        setSessionComplete(true);
      } else {
        setCurrentCardIndex((prev) => prev + 1);
        setShowAnswer(false);
      }
    } catch (err: any) {
      setError(err.message || 'Failed to submit review');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteCard(cardId: string) {
    try {
      await api.delete(`/learning-interventions/distributed-practice/cards/${cardId}`);

      // Remove from current queue
      const newCards = dueCards.filter((c) => c.id !== cardId);
      setDueCards(newCards);

      // Adjust current index if needed
      if (currentCardIndex >= newCards.length && newCards.length > 0) {
        setCurrentCardIndex(newCards.length - 1);
      }

      // Update stats
      if (stats) {
        setStats({
          ...stats,
          totalCards: stats.totalCards - 1,
          dueToday: Math.max(0, stats.dueToday - 1),
        });
      }

      // If no more cards, show session complete or empty state
      if (newCards.length === 0) {
        setSessionComplete(true);
      }
    } catch (err: any) {
      console.error('Failed to delete card:', err);
    }
  }

  function getIntervalText(rating: QualityRating): string {
    const currentCard = dueCards[currentCardIndex];
    if (!currentCard) return '';

    // Simplified interval preview
    switch (rating) {
      case 'again':
        return '< 1 day';
      case 'hard':
        return '~1 day';
      case 'good':
        return currentCard.repetitions === 0
          ? '1 day'
          : currentCard.repetitions === 1
            ? '6 days'
            : `~${Math.round(currentCard.interval * 2.5)} days`;
      case 'easy':
        return currentCard.repetitions === 0
          ? '1 day'
          : `~${Math.round(currentCard.interval * 3)} days`;
      default:
        return '';
    }
  }

  // Loading state
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="flex items-center justify-center py-16">
          <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      </div>
    );
  }

  // Error state
  if (error && !stats) {
    return (
      <div className="max-w-4xl mx-auto">
        <div className="bg-red-50 border border-red-200 rounded-lg p-6 text-center">
          <p className="text-red-600 mb-4">{error}</p>
          <button
            onClick={loadData}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  const currentCard = dueCards[currentCardIndex];

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900 mb-2">Review Queue</h1>
        <p className="text-gray-500">
          Practice your flashcards using spaced repetition for optimal retention
        </p>
      </div>

      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500 mb-1">Due Today</p>
            <p className="text-2xl font-bold text-blue-600">{stats.dueToday}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500 mb-1">Total Cards</p>
            <p className="text-2xl font-bold text-gray-900">{stats.totalCards}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500 mb-1">Due This Week</p>
            <p className="text-2xl font-bold text-gray-900">{stats.dueThisWeek}</p>
          </div>
          <div className="bg-white rounded-lg border border-gray-200 p-4">
            <p className="text-sm text-gray-500 mb-1">Cards by Stage</p>
            <div className="flex gap-2 text-xs">
              <span className="px-2 py-0.5 bg-gray-100 rounded">{stats.cardsByStage.new} new</span>
              <span className="px-2 py-0.5 bg-yellow-100 rounded">
                {stats.cardsByStage.learning} learning
              </span>
              <span className="px-2 py-0.5 bg-green-100 rounded">
                {stats.cardsByStage.mature} mature
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Session Complete State */}
      {sessionComplete && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">Review session complete!</h2>
          {sessionState.cardsReviewed > 0 && (
            <p className="text-gray-600 mb-6">
              You reviewed {sessionState.cardsReviewed} card{sessionState.cardsReviewed !== 1 ? 's' : ''}{' '}
              &mdash; {sessionState.ratings.good + sessionState.ratings.easy} Good/Easy,{' '}
              {sessionState.ratings.hard} Hard, {sessionState.ratings.again} Again
            </p>
          )}
          {totalDue - dueCards.length > 0 && (
            <p className="text-sm text-gray-500 mb-6">
              {totalDue - dueCards.length} more card{totalDue - dueCards.length !== 1 ? 's' : ''} due today
            </p>
          )}
          <div className="flex gap-3 justify-center">
            <button
              onClick={() => navigate('/student')}
              className="px-6 py-2 text-sm font-medium text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200"
            >
              Back to Dashboard
            </button>
            {totalDue - dueCards.length > 0 && (
              <button
                onClick={() => {
                  setSessionComplete(false);
                  setCurrentCardIndex(0);
                  setShowAnswer(false);
                  setSessionState({ cardsReviewed: 0, ratings: { again: 0, hard: 0, good: 0, easy: 0 } });
                  loadData();
                }}
                className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
              >
                Continue Reviewing
              </button>
            )}
          </div>
        </div>
      )}

      {/* Empty State */}
      {!sessionComplete && dueCards.length === 0 && (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center">
          <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
            <svg className="w-8 h-8 text-green-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
          </div>
          <h2 className="text-xl font-bold text-gray-900 mb-2">All caught up!</h2>
          <p className="text-gray-600 mb-2">No cards due for review right now.</p>
          {stats && stats.totalCards > 0 && (
            <p className="text-sm text-gray-500">
              Next review: {stats.dueThisWeek - stats.dueToday} card
              {stats.dueThisWeek - stats.dueToday !== 1 ? 's' : ''} due this week
            </p>
          )}
          {stats && stats.totalCards === 0 && (
            <p className="text-sm text-gray-500">
              Create flashcards from your course content to start learning!
            </p>
          )}
          <button
            onClick={() => navigate('/student')}
            className="mt-6 px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Back to Dashboard
          </button>
        </div>
      )}

      {/* Review Mode */}
      {!sessionComplete && currentCard && (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {/* Progress bar */}
          <div className="px-6 py-3 border-b border-gray-100 flex items-center justify-between">
            <span className="text-sm text-gray-500">
              Card {currentCardIndex + 1} of {dueCards.length}
            </span>
            {currentCard.courseName && (
              <span className="text-xs px-2 py-1 bg-gray-100 rounded text-gray-600">
                {currentCard.courseName}
              </span>
            )}
          </div>

          {/* Card content */}
          <div className="p-8">
            {/* Front (Question) */}
            <div className="text-center mb-8">
              <p className="text-xs uppercase tracking-wide text-gray-400 mb-3">Question</p>
              <p className="text-xl text-gray-900 font-medium">{currentCard.front}</p>
            </div>

            {/* Show Answer button / Answer */}
            {!showAnswer ? (
              <div className="text-center">
                <button
                  onClick={() => setShowAnswer(true)}
                  className="px-8 py-3 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
                >
                  Show Answer
                </button>
              </div>
            ) : (
              <>
                {/* Answer */}
                <div className="bg-blue-50 border border-blue-100 rounded-lg p-6 mb-8">
                  <p className="text-xs uppercase tracking-wide text-blue-400 mb-3 text-center">Answer</p>
                  <p className="text-gray-900 text-center">{currentCard.back}</p>
                </div>

                {/* Rating buttons */}
                <div className="space-y-3">
                  <p className="text-sm text-gray-500 text-center">How well did you remember?</p>
                  <div className="grid grid-cols-4 gap-3">
                    <button
                      onClick={() => handleRating('again')}
                      disabled={submitting}
                      className="flex flex-col items-center gap-1 px-4 py-3 bg-red-50 border border-red-200 rounded-lg hover:bg-red-100 disabled:opacity-50"
                    >
                      <span className="font-medium text-red-700">Again</span>
                      <span className="text-xs text-red-500">{getIntervalText('again')}</span>
                    </button>
                    <button
                      onClick={() => handleRating('hard')}
                      disabled={submitting}
                      className="flex flex-col items-center gap-1 px-4 py-3 bg-orange-50 border border-orange-200 rounded-lg hover:bg-orange-100 disabled:opacity-50"
                    >
                      <span className="font-medium text-orange-700">Hard</span>
                      <span className="text-xs text-orange-500">{getIntervalText('hard')}</span>
                    </button>
                    <button
                      onClick={() => handleRating('good')}
                      disabled={submitting}
                      className="flex flex-col items-center gap-1 px-4 py-3 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 disabled:opacity-50"
                    >
                      <span className="font-medium text-blue-700">Good</span>
                      <span className="text-xs text-blue-500">{getIntervalText('good')}</span>
                    </button>
                    <button
                      onClick={() => handleRating('easy')}
                      disabled={submitting}
                      className="flex flex-col items-center gap-1 px-4 py-3 bg-green-50 border border-green-200 rounded-lg hover:bg-green-100 disabled:opacity-50"
                    >
                      <span className="font-medium text-green-700">Easy</span>
                      <span className="text-xs text-green-500">{getIntervalText('easy')}</span>
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Card actions */}
          <div className="px-6 py-3 border-t border-gray-100 flex justify-end">
            <button
              onClick={() => handleDeleteCard(currentCard.id)}
              className="text-sm text-red-600 hover:text-red-700 flex items-center gap-1"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                />
              </svg>
              Delete Card
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
