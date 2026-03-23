import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import { useActivityLog } from '../../lib/activity-log';
import {
  FlaskConical,
  Footprints,
  Layers,
  MessageCircleQuestion,
  Trash2,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { SavedDataRenderer } from '../../components/FloatingChatbot/ReviewTabView';

type InterventionType =
  | 'PRACTICE_TESTING'
  | 'DISTRIBUTED_PRACTICE'
  | 'STEPWISE_LEARNING'
  | 'INTERROGATIVE_ELABORATION';

interface SavedReviewListItem {
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

interface SavedReviewDetail extends SavedReviewListItem {
  savedData: Record<string, unknown>;
}

interface SavedReviewsResponse {
  items: SavedReviewListItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

const TYPE_LABELS: Record<InterventionType, { icon: React.ReactNode; label: string }> = {
  PRACTICE_TESTING: { icon: <FlaskConical size={14} />, label: 'Practice Test' },
  STEPWISE_LEARNING: { icon: <Footprints size={14} />, label: 'Stepwise Learning' },
  DISTRIBUTED_PRACTICE: { icon: <Layers size={14} />, label: 'Flashcards' },
  INTERROGATIVE_ELABORATION: { icon: <MessageCircleQuestion size={14} />, label: 'Elaboration' },
};

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
  const [activeTab, setActiveTab] = useState<'flashcards' | 'saved-reviews'>('flashcards');

  return (
    <div className="max-w-2xl mx-auto p-6">
      <h1 className="text-xl font-bold text-gray-800 mb-4">Review Queue</h1>

      {/* Tab bar */}
      <div className="flex border-b border-gray-200 mb-6">
        <button
          onClick={() => setActiveTab('flashcards')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'flashcards'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Flashcards
        </button>
        <button
          onClick={() => setActiveTab('saved-reviews')}
          className={`px-4 py-2 text-sm font-medium transition-colors ${
            activeTab === 'saved-reviews'
              ? 'text-blue-600 border-b-2 border-blue-600'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          Saved Reviews
        </button>
      </div>

      {activeTab === 'flashcards' ? <FlashcardsTab /> : <SavedReviewsTab />}
    </div>
  );
}

// ─── Saved Reviews Tab ──────────────────────────────────────

function SavedReviewsTab() {
  const [reviews, setReviews] = useState<SavedReviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<InterventionType | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [expandedDetail, setExpandedDetail] = useState<SavedReviewDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);

  const fetchReviews = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams({ page: String(page), limit: '20' });
      if (typeFilter !== 'ALL') {
        params.set('interventionType', typeFilter);
      }
      const data = await api.get<SavedReviewsResponse>(
        `/learning-interventions/saved-reviews?${params}`,
      );
      setReviews(data.items);
      setTotalPages(data.totalPages);
    } catch {
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  const handleExpand = async (id: string) => {
    if (expandedId === id) {
      setExpandedId(null);
      setExpandedDetail(null);
      return;
    }
    setExpandedId(id);
    setDetailLoading(true);
    try {
      const detail = await api.get<SavedReviewDetail>(
        `/learning-interventions/saved-reviews/${id}`,
      );
      setExpandedDetail(detail);
    } catch {
      setExpandedDetail(null);
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/learning-interventions/saved-reviews/${id}`);
      setReviews((prev) => prev.filter((r) => r.id !== id));
      if (expandedId === id) {
        setExpandedId(null);
        setExpandedDetail(null);
      }
    } catch {
      // silently fail
    }
  };

  if (loading) {
    return <div className="text-center text-gray-400 py-16 animate-pulse">Loading...</div>;
  }

  if (reviews.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="text-4xl mb-4">{'\uD83D\uDCDA'}</div>
        <h2 className="text-lg font-semibold text-gray-700 mb-2">No saved reviews yet</h2>
        <p className="text-sm text-gray-500 max-w-md mx-auto">
          Use a learning strategy (Practice Testing, Distributed Practice, etc.) from the floating
          chatbot or the Learn tab in a dialogue session, then click &quot;Save to My Reviews&quot;
          to see your reviews here.
        </p>
      </div>
    );
  }

  return (
    <div>
      {/* Filter */}
      <div className="mb-4">
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as InterventionType | 'ALL');
            setPage(1);
          }}
          className="text-sm border border-gray-300 rounded-lg px-3 py-1.5"
        >
          <option value="ALL">All Types</option>
          <option value="PRACTICE_TESTING">Practice Testing</option>
          <option value="STEPWISE_LEARNING">Stepwise Learning</option>
          <option value="DISTRIBUTED_PRACTICE">Flashcards</option>
          <option value="INTERROGATIVE_ELABORATION">Elaboration</option>
        </select>
      </div>

      {/* List */}
      <div className="space-y-3">
        {reviews.map((review) => {
          const typeInfo = TYPE_LABELS[review.interventionType];
          const isExpanded = expandedId === review.id;

          return (
            <div
              key={review.id}
              className="bg-white border border-gray-200 rounded-lg overflow-hidden"
            >
              <div
                className="flex items-center gap-3 p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                onClick={() => handleExpand(review.id)}
              >
                <span className="text-gray-500">{typeInfo.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-gray-800 truncate">{review.title}</div>
                  <div className="text-xs text-gray-400 mt-0.5">
                    {typeInfo.label} &middot; {new Date(review.createdAt).toLocaleDateString()}
                  </div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    if (window.confirm('Delete this saved review?')) {
                      handleDelete(review.id);
                    }
                  }}
                  className="text-gray-400 hover:text-red-600 p-1 transition-colors"
                  title="Delete"
                >
                  <Trash2 size={14} />
                </button>
                {isExpanded ? (
                  <ChevronUp size={16} className="text-gray-400" />
                ) : (
                  <ChevronDown size={16} className="text-gray-400" />
                )}
              </div>

              {isExpanded && (
                <div className="px-4 pb-4 border-t border-gray-100 pt-3">
                  {detailLoading ? (
                    <div className="text-sm text-gray-400 animate-pulse">Loading details...</div>
                  ) : expandedDetail && expandedDetail.id === review.id ? (
                    <div className="space-y-3">
                      {/* Original text */}
                      <div>
                        <div className="text-xs font-medium text-gray-600 mb-1">Selected Text</div>
                        <div className="text-xs text-gray-700 bg-yellow-50 border border-yellow-200 rounded p-2 max-h-24 overflow-y-auto">
                          {expandedDetail.selectedText}
                        </div>
                      </div>

                      {/* Saved data - formatted view */}
                      <div>
                        <div className="text-xs font-medium text-gray-600 mb-1">
                          Interaction Data
                        </div>
                        <SavedDataRenderer
                          type={expandedDetail.interventionType}
                          data={expandedDetail.savedData}
                        />
                      </div>

                      {/* Notes */}
                      {expandedDetail.notes && (
                        <div>
                          <div className="text-xs font-medium text-gray-600 mb-1">Notes</div>
                          <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2">
                            {expandedDetail.notes}
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="text-sm text-gray-400">Could not load details.</div>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-4 mt-6">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-sm text-blue-600 disabled:text-gray-300"
          >
            Previous
          </button>
          <span className="text-sm text-gray-500">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="text-sm text-blue-600 disabled:text-gray-300"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Flashcards Tab ──────────────────────────────────────────

function FlashcardsTab() {
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
    return <div className="text-center text-gray-400 py-16 animate-pulse">Loading...</div>;
  }

  // ─── Empty State ──────────────────────────────────────
  if (phase === 'empty') {
    return (
      <div>
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
    );
  }

  // ─── Card Front / Back ──────────────────────────────────
  return (
    <div>
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
