import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { useActivityLog } from '../../lib/activity-log';

interface DueCard {
  id: string;
  front: string;
  back: string;
  ease: number;
  interval: number;
  repetitions: number;
  courseId: string;
}

interface RatingPreview {
  nextReviewAt: string;
  interval: number;
}

interface Stats {
  totalCards: number;
  dueToday: number;
  dueThisWeek: number;
  cardsByStage: { new: number; learning: number; mature: number };
}

type SessionPhase = 'loading' | 'empty' | 'front' | 'back' | 'summary';

interface SessionResult {
  quality: string;
  front: string;
}

const RATING_STYLES = {
  again: { label: 'Again', color: 'bg-red-100 text-red-700 border-red-300 hover:bg-red-200' },
  hard: {
    label: 'Hard',
    color: 'bg-orange-100 text-orange-700 border-orange-300 hover:bg-orange-200',
  },
  good: { label: 'Good', color: 'bg-blue-100 text-blue-700 border-blue-300 hover:bg-blue-200' },
  easy: { label: 'Easy', color: 'bg-green-100 text-green-700 border-green-300 hover:bg-green-200' },
} as const;

function formatInterval(days: number): string {
  if (days < 1) return '<1 day';
  if (days === 1) return '1 day';
  if (days < 30) return `${days} days`;
  if (days < 365) return `${Math.round(days / 30)} mo`;
  return `${Math.round(days / 365)} yr`;
}

export function ReviewQueuePage() {
  const { track } = useActivityLog();
  const [stats, setStats] = useState<Stats | null>(null);
  const [cards, setCards] = useState<DueCard[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [phase, setPhase] = useState<SessionPhase>('loading');
  const [previews, setPreviews] = useState<Record<string, RatingPreview> | null>(null);
  const [sessionResults, setSessionResults] = useState<SessionResult[]>([]);
  const [isRating, setIsRating] = useState(false);

  const fetchData = useCallback(async () => {
    setPhase('loading');
    try {
      const [statsData, dueData] = await Promise.all([
        api.get<Stats>('/learning-interventions/distributed-practice/stats'),
        api.get<{ cards: DueCard[]; total: number }>(
          '/learning-interventions/distributed-practice/due?limit=50',
        ),
      ]);
      setStats(statsData);
      setCards(dueData.cards);
      setCurrentIndex(0);
      setSessionResults([]);

      if (dueData.cards.length === 0) {
        setPhase('empty');
      } else {
        setPhase('front');
      }
    } catch {
      setStats(null);
      setCards([]);
      setPhase('empty');
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const currentCard = cards[currentIndex];

  const handleShowAnswer = async () => {
    if (!currentCard) return;
    setPhase('back');
    setPreviews(null);
    track('SPACED_REP_CARD_VIEWED', {
      courseId: currentCard.courseId,
      metadata: { cardId: currentCard.id, summary: currentCard.front.slice(0, 80) },
    });

    try {
      const data = await api.get<Record<string, RatingPreview>>(
        `/learning-interventions/distributed-practice/cards/${currentCard.id}/preview`,
      );
      setPreviews(data);
    } catch {
      // Still show the back, just without interval previews
    }
  };

  const handleRate = async (quality: keyof typeof RATING_STYLES) => {
    if (!currentCard || isRating) return;
    setIsRating(true);

    try {
      await api.patch(
        `/learning-interventions/distributed-practice/cards/${currentCard.id}/review`,
        {
          quality,
        },
      );
    } catch {
      // Still advance even if the API fails
    }

    track('SPACED_REP_CARD_RATED', {
      courseId: currentCard.courseId,
      metadata: {
        cardId: currentCard.id,
        quality,
        summary: `Rated ${quality}: ${currentCard.front.slice(0, 60)}`,
      },
    });
    setSessionResults((prev) => [...prev, { quality, front: currentCard.front }]);

    const nextIndex = currentIndex + 1;
    if (nextIndex >= cards.length) {
      setPhase('summary');
    } else {
      setCurrentIndex(nextIndex);
      setPreviews(null);
      setPhase('front');
    }
    setIsRating(false);
  };

  // ─── Loading ──────────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-xl font-bold text-gray-800 mb-4">Review Queue</h1>
        <div className="text-center text-gray-400 py-16 animate-pulse">Loading...</div>
      </div>
    );
  }

  // ─── Empty State ──────────────────────────────────────
  if (phase === 'empty') {
    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-xl font-bold text-gray-800 mb-4">Review Queue</h1>

        {/* Stats bar */}
        {stats && (
          <div className="flex items-center gap-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3 mb-6">
            <span>Total Cards: {stats.totalCards}</span>
            <span>Due This Week: {stats.dueThisWeek}</span>
          </div>
        )}

        <div className="text-center py-16">
          <div className="text-4xl mb-4">{'\uD83C\uDF89'}</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">All caught up!</h2>
          <p className="text-sm text-gray-500 mb-2">No cards due for review.</p>
          {stats && stats.dueThisWeek > 0 && (
            <p className="text-sm text-gray-500 mb-4">{stats.dueThisWeek} cards due this week.</p>
          )}
          <p className="text-xs text-gray-400 max-w-md mx-auto">
            Tip: Select text on any lesson or quiz and use &quot;Distributed Practice&quot; in the
            chatbot to create new flashcards.
          </p>
        </div>
      </div>
    );
  }

  // ─── Session Summary ──────────────────────────────────
  if (phase === 'summary') {
    const counts: Record<string, number> = {};
    for (const r of sessionResults) {
      counts[r.quality] = (counts[r.quality] || 0) + 1;
    }

    return (
      <div className="max-w-2xl mx-auto p-6">
        <h1 className="text-xl font-bold text-gray-800 mb-4">Review Queue</h1>
        <div className="text-center py-8">
          <div className="text-4xl mb-3">{'\u2705'}</div>
          <h2 className="text-lg font-semibold text-gray-700 mb-2">Review session complete!</h2>
          <p className="text-sm text-gray-600 mb-4">You reviewed {sessionResults.length} cards:</p>

          <div className="flex items-center justify-center gap-3 mb-6">
            {Object.entries(counts).map(([q, count]) => {
              const style = RATING_STYLES[q as keyof typeof RATING_STYLES];
              return (
                <span
                  key={q}
                  className={`text-sm px-3 py-1 rounded-full border ${style?.color || 'bg-gray-100'}`}
                >
                  {count} {style?.label || q}
                </span>
              );
            })}
          </div>

          {counts['again'] && counts['again'] > 0 && (
            <p className="text-xs text-gray-500 mb-4">
              The &quot;Again&quot; cards will reappear tomorrow.
            </p>
          )}

          <button
            onClick={fetchData}
            className="text-sm bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Dashboard
          </button>
        </div>
      </div>
    );
  }

  // ─── Card Front / Back ──────────────────────────────────
  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-4">Review Queue</h1>

      {/* Stats bar */}
      {stats && (
        <div className="flex items-center gap-4 text-sm text-gray-600 bg-gray-50 border border-gray-200 rounded-lg p-3 mb-6">
          <span>Due Today: {stats.dueToday}</span>
          <span>Total Cards: {stats.totalCards}</span>
        </div>
      )}

      {/* Card counter */}
      <div className="text-center text-sm text-gray-500 mb-4">
        Card {currentIndex + 1} of {cards.length}
      </div>

      {currentCard && (
        <div className="relative" style={{ perspective: '1000px' }}>
          <div
            className="relative transition-transform duration-500 mx-auto"
            style={{
              transformStyle: 'preserve-3d',
              transform: phase === 'back' ? 'rotateY(180deg)' : 'rotateY(0deg)',
              minHeight: '200px',
              maxWidth: '500px',
            }}
          >
            {/* Front */}
            <div
              className="absolute inset-0 bg-white border-2 border-gray-200 rounded-xl p-6 flex flex-col items-center justify-center text-center shadow-md"
              style={{ backfaceVisibility: 'hidden' }}
            >
              <div className="text-sm text-gray-800 leading-relaxed">{currentCard.front}</div>
            </div>

            {/* Back */}
            <div
              className="absolute inset-0 bg-blue-50 border-2 border-blue-200 rounded-xl p-6 flex flex-col items-center justify-center text-center shadow-md"
              style={{
                backfaceVisibility: 'hidden',
                transform: 'rotateY(180deg)',
              }}
            >
              <div className="text-sm text-gray-800 leading-relaxed">{currentCard.back}</div>
            </div>
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="mt-6 text-center">
        {phase === 'front' && (
          <button
            onClick={handleShowAnswer}
            className="text-sm bg-blue-600 text-white px-6 py-2.5 rounded-lg hover:bg-blue-700 transition-colors"
          >
            Show Answer
          </button>
        )}

        {phase === 'back' && (
          <div>
            <p className="text-sm text-gray-600 mb-3">How well did you remember?</p>
            <div className="flex items-center justify-center gap-2">
              {(Object.keys(RATING_STYLES) as Array<keyof typeof RATING_STYLES>).map((quality) => {
                const style = RATING_STYLES[quality];
                const preview = previews?.[quality];
                return (
                  <button
                    key={quality}
                    onClick={() => handleRate(quality)}
                    disabled={isRating}
                    className={`border rounded-lg px-4 py-2 transition-colors disabled:opacity-50 ${style.color}`}
                  >
                    <div className="text-sm font-medium">{style.label}</div>
                    {preview && (
                      <div className="text-[10px] opacity-70">
                        {formatInterval(preview.interval)}
                      </div>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
