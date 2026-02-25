import { useState, useEffect, useCallback } from 'react';
import { api } from '../../lib/api';
import type {
  InterventionType,
  SavedReviewListItem,
  SavedReviewDetail,
  SavedReviewsResponse,
} from './types';

const TYPE_LABELS: Record<InterventionType, { icon: string; label: string }> = {
  PRACTICE_TESTING: { icon: '\uD83E\uDDEA', label: 'Practice Test' },
  STEPWISE_LEARNING: { icon: '\uD83D\uDCDD', label: 'Stepwise Learning' },
  DISTRIBUTED_PRACTICE: { icon: '\uD83C\uDCCF', label: 'Flashcards' },
  INTERROGATIVE_ELABORATION: { icon: '\uD83D\uDCA1', label: 'Elaboration' },
};

const TYPE_OPTIONS: Array<{ value: InterventionType | 'ALL'; label: string }> = [
  { value: 'ALL', label: 'All Types' },
  { value: 'PRACTICE_TESTING', label: 'Practice Testing' },
  { value: 'STEPWISE_LEARNING', label: 'Stepwise Learning' },
  { value: 'DISTRIBUTED_PRACTICE', label: 'Flashcards' },
  { value: 'INTERROGATIVE_ELABORATION', label: 'Elaboration' },
];

interface ReviewTabViewProps {
  onBack: () => void;
}

export function ReviewTabView({ onBack }: ReviewTabViewProps) {
  const [reviews, setReviews] = useState<SavedReviewListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [typeFilter, setTypeFilter] = useState<InterventionType | 'ALL'>('ALL');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedReview, setSelectedReview] = useState<SavedReviewDetail | null>(null);
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
      // silently fail, show empty state
      setReviews([]);
    } finally {
      setLoading(false);
    }
  }, [page, typeFilter]);

  useEffect(() => {
    void fetchReviews();
  }, [fetchReviews]);

  const handleViewDetail = async (id: string) => {
    setDetailLoading(true);
    try {
      const detail = await api.get<SavedReviewDetail>(
        `/learning-interventions/saved-reviews/${id}`,
      );
      setSelectedReview(detail);
    } catch {
      // silently fail
    } finally {
      setDetailLoading(false);
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await api.delete(`/learning-interventions/saved-reviews/${id}`);
      setSelectedReview(null);
      void fetchReviews();
    } catch {
      // silently fail
    }
  };

  const handleUpdateNotes = async (id: string, notes: string) => {
    try {
      await api.patch(`/learning-interventions/saved-reviews/${id}`, { notes });
      if (selectedReview && selectedReview.id === id) {
        setSelectedReview({ ...selectedReview, notes });
      }
    } catch {
      // silently fail
    }
  };

  // ─── Detail View ─────────────────────────────────────────
  if (selectedReview) {
    return (
      <ReviewDetailView
        review={selectedReview}
        onBack={() => setSelectedReview(null)}
        onDelete={handleDelete}
        onUpdateNotes={handleUpdateNotes}
      />
    );
  }

  // ─── List View ───────────────────────────────────────────
  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-800">
          &larr; Back to chat
        </button>
        <span className="text-sm font-medium text-gray-700 ml-auto">My Reviews</span>
      </div>

      {/* Filters */}
      <div className="px-3 py-2 border-b border-gray-100">
        <select
          value={typeFilter}
          onChange={(e) => {
            setTypeFilter(e.target.value as InterventionType | 'ALL');
            setPage(1);
          }}
          className="text-xs border border-gray-300 rounded px-2 py-1 w-full"
        >
          {TYPE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {loading ? (
          <div className="text-center text-gray-400 text-sm py-8">Loading...</div>
        ) : reviews.length === 0 ? (
          <div className="text-center text-gray-400 text-sm py-8">
            <div className="text-2xl mb-2">&#128218;</div>
            No saved reviews yet.
            <br />
            <span className="text-xs">
              Select text on any page and use a learning strategy to get started.
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-2">
            {reviews.map((review) => {
              const typeInfo = TYPE_LABELS[review.interventionType];
              return (
                <div
                  key={review.id}
                  className="border border-gray-200 rounded-lg p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="text-xs text-gray-500 mb-1">
                        {typeInfo.icon} {typeInfo.label}
                      </div>
                      <div className="text-sm font-medium text-gray-800 truncate">
                        {review.title}
                      </div>
                      <div className="text-xs text-gray-400 mt-1">
                        {new Date(review.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleViewDetail(review.id)}
                      disabled={detailLoading}
                      className="text-xs bg-blue-50 text-blue-600 px-2 py-1 rounded hover:bg-blue-100 transition-colors whitespace-nowrap"
                    >
                      View
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-center gap-2 px-3 py-2 border-t border-gray-100">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="text-xs text-blue-600 disabled:text-gray-300"
          >
            Prev
          </button>
          <span className="text-xs text-gray-500">
            {page} / {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className="text-xs text-blue-600 disabled:text-gray-300"
          >
            Next
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Review Detail Sub-component ──────────────────────────

function ReviewDetailView({
  review,
  onBack,
  onDelete,
  onUpdateNotes,
}: {
  review: SavedReviewDetail;
  onBack: () => void;
  onDelete: (id: string) => void;
  onUpdateNotes: (id: string, notes: string) => void;
}) {
  const [notes, setNotes] = useState(review.notes || '');
  const [editingNotes, setEditingNotes] = useState(false);
  const typeInfo = TYPE_LABELS[review.interventionType];

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-200 bg-gray-50">
        <button onClick={onBack} className="text-sm text-blue-600 hover:text-blue-800">
          &larr; Back to reviews
        </button>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-3">
        {/* Type badge */}
        <div className="text-xs text-gray-500 mb-1">
          {typeInfo.icon} {typeInfo.label}
        </div>

        {/* Title */}
        <h3 className="text-sm font-semibold text-gray-800 mb-2">{review.title}</h3>

        {/* Date */}
        <div className="text-xs text-gray-400 mb-3">
          Saved {new Date(review.createdAt).toLocaleDateString()}
        </div>

        {/* Original text */}
        <div className="mb-3">
          <div className="text-xs font-medium text-gray-600 mb-1">Original Selected Text</div>
          <div className="text-xs text-gray-700 bg-yellow-50 border border-yellow-200 rounded p-2 max-h-24 overflow-y-auto">
            {review.selectedText}
          </div>
        </div>

        {/* Saved data - type-specific rendering */}
        <div className="mb-3">
          <div className="text-xs font-medium text-gray-600 mb-1">Interaction Data</div>
          <SavedDataRenderer type={review.interventionType} data={review.savedData} />
        </div>

        {/* Notes */}
        <div className="mb-3">
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs font-medium text-gray-600">Notes</span>
            {!editingNotes && (
              <button
                onClick={() => setEditingNotes(true)}
                className="text-xs text-blue-600 hover:text-blue-800"
              >
                Edit
              </button>
            )}
          </div>
          {editingNotes ? (
            <div>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                className="w-full text-xs border border-gray-300 rounded p-2 h-20 resize-none"
                placeholder="Add your notes..."
              />
              <div className="flex gap-2 mt-1">
                <button
                  onClick={() => {
                    onUpdateNotes(review.id, notes);
                    setEditingNotes(false);
                  }}
                  className="text-xs bg-blue-600 text-white px-2 py-1 rounded hover:bg-blue-700"
                >
                  Save
                </button>
                <button
                  onClick={() => {
                    setNotes(review.notes || '');
                    setEditingNotes(false);
                  }}
                  className="text-xs text-gray-600 px-2 py-1 rounded hover:bg-gray-100"
                >
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <div className="text-xs text-gray-500 bg-gray-50 border border-gray-200 rounded p-2 min-h-[2rem]">
              {review.notes || 'No notes yet.'}
            </div>
          )}
        </div>
      </div>

      {/* Footer actions */}
      <div className="px-3 py-2 border-t border-gray-200 flex justify-end">
        <button
          onClick={() => {
            if (window.confirm('Delete this saved review?')) {
              onDelete(review.id);
            }
          }}
          className="text-xs text-red-600 hover:text-red-800 px-2 py-1"
        >
          Delete
        </button>
      </div>
    </div>
  );
}

// ─── Type-specific Saved Data Renderers ──────────────────

function SavedDataRenderer({
  type,
  data,
}: {
  type: InterventionType;
  data: Record<string, unknown>;
}) {
  switch (type) {
    case 'PRACTICE_TESTING':
      return <PracticeTestRenderer data={data} />;
    case 'STEPWISE_LEARNING':
      return <StepwiseRenderer data={data} />;
    case 'DISTRIBUTED_PRACTICE':
      return <FlashcardRenderer data={data} />;
    case 'INTERROGATIVE_ELABORATION':
      return <ElaborationRenderer data={data} />;
    default:
      return (
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 max-h-48 overflow-y-auto">
          <pre className="whitespace-pre-wrap break-words">{JSON.stringify(data, null, 2)}</pre>
        </div>
      );
  }
}

interface PracticeQuestion {
  question?: string;
  answer?: string;
  userAnswer?: string;
  correct?: boolean;
}

function PracticeTestRenderer({ data }: { data: Record<string, unknown> }) {
  const questions = Array.isArray(data.questions) ? (data.questions as PracticeQuestion[]) : [];
  const score = typeof data.score === 'number' ? data.score : null;

  if (questions.length === 0) {
    return <FallbackJson data={data} />;
  }

  return (
    <div className="space-y-2">
      {score !== null && (
        <div className="text-xs font-medium text-gray-700 bg-blue-50 border border-blue-200 rounded px-2 py-1">
          Score: {score}%
        </div>
      )}
      {questions.map((q, i) => (
        <div key={i} className="text-xs bg-gray-50 border border-gray-200 rounded p-2">
          <div className="font-medium text-gray-800 mb-1">
            Q{i + 1}: {q.question}
          </div>
          {q.userAnswer && (
            <div className={`mb-0.5 ${q.correct === false ? 'text-red-600' : 'text-green-700'}`}>
              Your answer: {q.userAnswer} {q.correct === true && '\u2713'}
              {q.correct === false && '\u2717'}
            </div>
          )}
          {q.answer && <div className="text-gray-500">Correct answer: {q.answer}</div>}
        </div>
      ))}
    </div>
  );
}

interface StepwiseStep {
  title?: string;
  content?: string;
  completed?: boolean;
}

function StepwiseRenderer({ data }: { data: Record<string, unknown> }) {
  const steps = Array.isArray(data.steps) ? (data.steps as StepwiseStep[]) : [];

  if (steps.length === 0) {
    return <FallbackJson data={data} />;
  }

  return (
    <div className="space-y-1.5">
      {steps.map((step, i) => (
        <div key={i} className="text-xs bg-gray-50 border border-gray-200 rounded p-2 flex gap-2">
          <span className={`shrink-0 ${step.completed ? 'text-green-600' : 'text-gray-400'}`}>
            {step.completed ? '\u2713' : `${i + 1}.`}
          </span>
          <div className="min-w-0">
            {step.title && <div className="font-medium text-gray-800">{step.title}</div>}
            {step.content && <div className="text-gray-600 mt-0.5">{step.content}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

interface Flashcard {
  front?: string;
  back?: string;
}

function FlashcardRenderer({ data }: { data: Record<string, unknown> }) {
  const cards = Array.isArray(data.cards) ? (data.cards as Flashcard[]) : [];

  if (cards.length === 0) {
    return <FallbackJson data={data} />;
  }

  return (
    <div className="space-y-2">
      {cards.map((card, i) => (
        <div key={i} className="text-xs border border-gray-200 rounded overflow-hidden">
          <div className="bg-blue-50 px-2 py-1.5 font-medium text-gray-800">
            {card.front || `Card ${i + 1}`}
          </div>
          <div className="bg-white px-2 py-1.5 text-gray-600 border-t border-gray-100">
            {card.back || '—'}
          </div>
        </div>
      ))}
    </div>
  );
}

interface ElaborationEntry {
  question?: string;
  questionType?: string;
  userElaboration?: string;
  rating?: string;
  addressedPoints?: string[];
  missedPoints?: string[];
  feedback?: string;
  modelElaboration?: string;
}

interface ElaborationSummary {
  strong?: number;
  developing?: number;
  needsImprovement?: number;
}

function ElaborationRenderer({ data }: { data: Record<string, unknown> }) {
  const elaborations = Array.isArray(data.elaborations)
    ? (data.elaborations as ElaborationEntry[])
    : [];
  const summary = (data.overallSummary as ElaborationSummary) || null;

  // Fallback for old format
  if (elaborations.length === 0) {
    const items = Array.isArray(data.questions)
      ? (data.questions as { question?: string; elaboration?: string; feedback?: string }[])
      : [];
    if (items.length === 0) return <FallbackJson data={data} />;
    return (
      <div className="space-y-2">
        {items.map((item, i) => (
          <div key={i} className="text-xs bg-gray-50 border border-gray-200 rounded p-2">
            {item.question && <div className="font-medium text-gray-800 mb-1">{item.question}</div>}
            {item.elaboration && (
              <div className="text-gray-700 mb-1 pl-2 border-l-2 border-blue-300">
                {item.elaboration}
              </div>
            )}
            {item.feedback && <div className="text-gray-500 italic">{item.feedback}</div>}
          </div>
        ))}
      </div>
    );
  }

  const ratingColors: Record<string, string> = {
    Strong: 'bg-green-100 text-green-700',
    Developing: 'bg-yellow-100 text-yellow-700',
    'Needs Improvement': 'bg-red-100 text-red-700',
  };

  return (
    <div className="space-y-2">
      {/* Summary bar */}
      {summary && (
        <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded px-2 py-1.5 flex gap-2 flex-wrap">
          {(summary.strong ?? 0) > 0 && (
            <span className="text-green-700">{summary.strong} Strong</span>
          )}
          {(summary.developing ?? 0) > 0 && (
            <span className="text-yellow-700">{summary.developing} Developing</span>
          )}
          {(summary.needsImprovement ?? 0) > 0 && (
            <span className="text-red-700">{summary.needsImprovement} Needs Improvement</span>
          )}
        </div>
      )}

      {elaborations.map((item, i) => {
        const colorClass = ratingColors[item.rating || ''] || 'bg-gray-100 text-gray-600';
        return <ElaborationDetailCard key={i} item={item} index={i} colorClass={colorClass} />;
      })}
    </div>
  );
}

function ElaborationDetailCard({
  item,
  index,
  colorClass,
}: {
  item: ElaborationEntry;
  index: number;
  colorClass: string;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="text-xs border border-gray-200 rounded overflow-hidden">
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center gap-2 px-2 py-1.5 text-left bg-gray-50 hover:bg-gray-100 transition-colors"
      >
        <span className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${colorClass}`}>
          {item.rating || '?'}
        </span>
        <span className="text-gray-800 flex-1 truncate">
          Q{index + 1}
          {item.questionType && (
            <span className="text-gray-400 ml-1">({item.questionType.toUpperCase()})</span>
          )}
          {item.question ? `: ${item.question}` : ''}
        </span>
        <span className="text-gray-400 text-[10px]">{expanded ? '\u25B2' : '\u25BC'}</span>
      </button>
      {expanded && (
        <div className="px-2 py-2 space-y-1.5 border-t border-gray-100">
          {item.question && <div className="font-medium text-gray-800">{item.question}</div>}
          {item.userElaboration && (
            <div className="text-gray-700 pl-2 border-l-2 border-blue-300">
              {item.userElaboration}
            </div>
          )}
          {item.addressedPoints && item.addressedPoints.length > 0 && (
            <div className="text-green-700">
              {item.addressedPoints.map((p, j) => (
                <div key={j} className="flex items-start gap-1">
                  <span className="shrink-0">{'\u2705'}</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          )}
          {item.missedPoints && item.missedPoints.length > 0 && (
            <div className="text-orange-700">
              {item.missedPoints.map((p, j) => (
                <div key={j} className="flex items-start gap-1">
                  <span className="shrink-0">{'\u2192'}</span>
                  <span>{p}</span>
                </div>
              ))}
            </div>
          )}
          {item.feedback && <div className="text-gray-500 italic">{item.feedback}</div>}
          {item.modelElaboration && (
            <div className="bg-gray-50 border border-gray-200 rounded p-1.5 text-gray-600">
              <span className="font-medium">Model answer: </span>
              {item.modelElaboration}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function FallbackJson({ data }: { data: Record<string, unknown> }) {
  return (
    <div className="text-xs text-gray-600 bg-gray-50 border border-gray-200 rounded p-2 max-h-48 overflow-y-auto">
      <pre className="whitespace-pre-wrap break-words">{JSON.stringify(data, null, 2)}</pre>
    </div>
  );
}
