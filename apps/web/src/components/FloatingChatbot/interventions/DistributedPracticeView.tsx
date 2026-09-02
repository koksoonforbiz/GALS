import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import { useActivityLog } from '../../../lib/activity-log';
import type { SaveForReviewInput } from '../types';
import { Layers, AlertTriangle, Inbox, Trash2 } from 'lucide-react';

interface DistributedPracticeViewProps {
  selectedText: string;
  courseId: string;
  contentId: string | null;
  pageType: string;
  contentTitle: string;
  documentId?: string | null;
  pageNumber?: number | null;
  onComplete: () => void;
  onBack: () => void;
  onSaveForReview: (data: SaveForReviewInput) => void;
}

interface FlashcardItem {
  id: string;
  front: string;
  back: string;
}

type Phase = 'loading' | 'preview' | 'error';

export function DistributedPracticeView({
  selectedText,
  courseId,
  contentId,
  pageType,
  contentTitle,
  documentId,
  pageNumber,
  onComplete,
  onBack,
  onSaveForReview,
}: DistributedPracticeViewProps) {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<Phase>('loading');
  const [interventionId, setInterventionId] = useState<string | null>(null);
  const [cards, setCards] = useState<FlashcardItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const [saved, setSaved] = useState(false);
  const [userNotes, setUserNotes] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const initialGenDone = useRef(false);

  const { track } = useActivityLog();
  // Per-card timing. cardShownAt = when the front of the current
  // card was rendered. cardFlippedAt = when the student tapped to
  // reveal the back (null until they flip). cardSeenCountRef counts
  // how many times each card has been viewed (front-side renders)
  // across the session. interventionStartedAt = the first time we
  // entered preview phase (anchor for total duration).
  const interventionStartedAtRef = useRef<number>(Date.now());
  const interventionViewedFiredRef = useRef(false);
  const cardShownAtRef = useRef<number>(Date.now());
  const cardFlippedAtRef = useRef<number | null>(null);
  const cardSeenCountRef = useRef<Record<string, number>>({});

  const generate = useCallback(async () => {
    setPhase('loading');
    try {
      const result = await api.post<{
        interventionId: string;
        cards: FlashcardItem[];
        totalCreated: number;
      }>(
        '/learning-interventions/distributed-practice/generate',
        {
          selectedText,
          courseId,
          contentId: contentId || undefined,
          pageType,
          topic: contentTitle || undefined,
          cardCount: 5,
          ...(documentId ? { documentId } : {}),
          ...(pageNumber != null ? { pageNumber } : {}),
        },
        // Without a selection this falls back to RAG retrieval over the
        // whole course before the LLM call even starts — routinely
        // slower than the default 15s abort timeout, which was only
        // meant to catch a genuinely unreachable API.
        { timeoutMs: 60_000 },
      );
      setInterventionId(result.interventionId);
      setCards(result.cards);
      setPhase('preview');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate flashcards');
      setPhase('error');
    }
  }, [selectedText, courseId, contentId, pageType, documentId, pageNumber]);

  useEffect(() => {
    if (initialGenDone.current) return;
    initialGenDone.current = true;
    void generate();
  }, [generate]);

  // Fire INTERVENTION_VIEWED when the deck becomes interactive.
  // Pairs with server-side INTERVENTION_TRIGGERED.
  useEffect(() => {
    if (phase === 'preview' && !interventionViewedFiredRef.current && interventionId) {
      interventionViewedFiredRef.current = true;
      interventionStartedAtRef.current = Date.now();
      cardShownAtRef.current = Date.now();
      track('INTERVENTION_VIEWED', {
        courseId,
        moduleItemId: contentId ?? undefined,
        interventionId,
        metadata: {
          interventionType: 'DISTRIBUTED_PRACTICE',
          cardCount: cards.length,
          contentTitle: contentTitle || null,
          hasSelection: Boolean(selectedText && selectedText.length >= 20),
        },
      });
    }
  }, [phase, interventionId, cards.length, track, courseId, contentId, contentTitle, selectedText]);

  const currentCard = cards[currentIndex];

  // Fire SPACED_REP_CARD_VIEWED whenever currentCard.id changes
  // (initial mount + nav). Track per-card seen count so we can
  // distinguish first-look vs re-look in analysis.
  useEffect(() => {
    if (phase !== 'preview' || !currentCard || !interventionId) return;
    cardShownAtRef.current = Date.now();
    cardFlippedAtRef.current = null;
    cardSeenCountRef.current[currentCard.id] = (cardSeenCountRef.current[currentCard.id] ?? 0) + 1;
    track('SPACED_REP_CARD_VIEWED', {
      courseId,
      moduleItemId: contentId ?? undefined,
      interventionId,
      metadata: {
        interventionType: 'DISTRIBUTED_PRACTICE',
        cardId: currentCard.id,
        cardIndex: currentIndex,
        cardCount: cards.length,
        seenCount: cardSeenCountRef.current[currentCard.id],
      },
    });
  }, [
    currentCard?.id,
    phase,
    interventionId,
    currentIndex,
    cards.length,
    track,
    courseId,
    contentId,
  ]);

  const handlePrev = () => {
    // Emit a CARD_NEXT-style transition event piggybacking on
    // SPACED_REP_CARD_VIEWED via the metadata on the next render.
    // The per-card-time durations are emitted in handleFlip /
    // handleNext (timeOnFront, timeOnBack).
    emitCardTransition('prev');
    setFlipped(false);
    setCurrentIndex((i) => Math.max(0, i - 1));
  };

  const handleNext = () => {
    emitCardTransition('next');
    setFlipped(false);
    setCurrentIndex((i) => Math.min(cards.length - 1, i + 1));
  };

  // Helper: when leaving a card, emit a QUESTION_ANSWERED event
  // carrying timeOnFront / timeOnBack so analysis can compute
  // hesitation per-side. We reuse QUESTION_ANSWERED (vs adding a
  // brand-new action) per the user's "reuse existing enums" rule —
  // semantically the student "answered" by deciding whether they
  // knew the back and moving on.
  const emitCardTransition = (direction: 'next' | 'prev' | 'dot') => {
    if (!currentCard || !interventionId) return;
    const now = Date.now();
    const timeOnFrontMs = cardFlippedAtRef.current
      ? cardFlippedAtRef.current - cardShownAtRef.current
      : now - cardShownAtRef.current;
    const timeOnBackMs = cardFlippedAtRef.current ? now - cardFlippedAtRef.current : 0;
    track('QUESTION_ANSWERED', {
      courseId,
      moduleItemId: contentId ?? undefined,
      interventionId,
      metadata: {
        interventionType: 'DISTRIBUTED_PRACTICE',
        action: 'card_transition',
        direction,
        cardId: currentCard.id,
        cardIndex: currentIndex,
        timeOnFrontMs,
        timeOnBackMs,
        flipped: cardFlippedAtRef.current !== null,
        seenCount: cardSeenCountRef.current[currentCard.id] ?? 1,
      },
    });
  };

  const handleDeleteCard = async (cardId: string) => {
    try {
      await api.delete(`/learning-interventions/distributed-practice/cards/${cardId}`);
      const updated = cards.filter((c) => c.id !== cardId);
      setCards(updated);
      if (currentIndex >= updated.length && updated.length > 0) {
        setCurrentIndex(updated.length - 1);
      }
      setFlipped(false);
    } catch {
      // silently fail
    }
  };

  const handleSave = () => {
    if (!interventionId) return;

    onSaveForReview({
      interventionId,
      interventionType: 'DISTRIBUTED_PRACTICE',
      title: `Flashcards - ${contentTitle || 'Untitled'}`,
      selectedText,
      savedData: {
        cards: cards.map((c) => ({ id: c.id, front: c.front, back: c.back })),
        totalCards: cards.length,
        createdAt: new Date().toISOString(),
      },
    });
    setSaved(true);
    // Roll up per-card view counts so analysis can compute coverage
    // (how many cards the student looked at vs the deck size) and
    // re-exposure depth (max times any card was re-viewed).
    const seenCounts = Object.values(cardSeenCountRef.current);
    const cardsViewed = seenCounts.length;
    const maxRepeat = seenCounts.length > 0 ? Math.max(...seenCounts) : 0;
    track('INTERVENTION_COMPLETED', {
      courseId,
      moduleItemId: contentId ?? undefined,
      interventionId,
      metadata: {
        interventionType: 'DISTRIBUTED_PRACTICE',
        totalCards: cards.length,
        cardsViewed,
        maxRepeatViews: maxRepeat,
        totalDurationMs: Date.now() - interventionStartedAtRef.current,
        completed: true,
      },
    });
  };

  const handleRetry = () => {
    setCards([]);
    setCurrentIndex(0);
    setFlipped(false);
    setSaved(false);
    setUserNotes('');
    setErrorMsg('');
    initialGenDone.current = false;
    void generate();
  };

  // ─── Loading Phase ──────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <Layers size={28} className="text-blue-500 mb-3 animate-pulse" />
        <p className="text-sm text-gray-600">Creating flashcards...</p>
        <p className="text-xs text-gray-400 mt-2">This may take a few seconds</p>
        <div className="w-48 bg-gray-200 rounded-full h-1.5 mt-4 overflow-hidden">
          <div
            className="bg-blue-500 h-1.5 rounded-full"
            style={{ width: '40%', animation: 'indeterminate 1.5s ease-in-out infinite' }}
          />
        </div>
        <style>{`@keyframes indeterminate { 0% { transform: translateX(-100%); } 100% { transform: translateX(350%); } }`}</style>
      </div>
    );
  }

  // ─── Error Phase ────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <AlertTriangle size={28} className="text-amber-500 mb-3" />
        <p className="text-sm text-red-600 mb-3">{errorMsg}</p>
        <div className="flex gap-2">
          <button
            onClick={handleRetry}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700 transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={onBack}
            className="text-xs text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100 transition-colors"
          >
            Back to Chat
          </button>
        </div>
      </div>
    );
  }

  // ─── Preview Phase ──────────────────────────────────────
  if (cards.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <Inbox size={28} className="text-gray-400 mb-3" />
        <p className="text-sm text-gray-600 mb-3">All cards have been removed.</p>
        <div className="flex gap-2">
          <button
            onClick={handleRetry}
            className="text-xs bg-blue-600 text-white px-3 py-1.5 rounded hover:bg-blue-700"
          >
            Generate New Cards
          </button>
          <button
            onClick={onComplete}
            className="text-xs text-gray-600 px-3 py-1.5 rounded hover:bg-gray-100"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header */}
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between mb-1">
          <button onClick={onBack} className="text-xs text-blue-600 hover:text-blue-800">
            &larr; Back to chat
          </button>
          <span className="text-xs font-medium text-gray-600">Distributed Practice</span>
        </div>
      </div>

      {/* Success message */}
      <div className="px-3 py-2 bg-green-50 border-b border-green-200">
        <div className="text-xs text-green-700">
          {'\u2705'} {cards.length} flashcards created! Added to Review Queue. First review:
          tomorrow.
        </div>
      </div>

      {/* Card area */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {currentCard && (
          <>
            {/* Flashcard with flip */}
            <div
              className="relative cursor-pointer select-none"
              style={{ perspective: '1000px' }}
              onClick={() => {
                // First flip = mark the moment so timeOnFront /
                // timeOnBack can be derived when the student leaves
                // the card. Re-flipping back doesn't reset (the back
                // was already revealed).
                if (!flipped && cardFlippedAtRef.current === null) {
                  cardFlippedAtRef.current = Date.now();
                }
                setFlipped(!flipped);
              }}
            >
              <div
                className="relative transition-transform duration-500"
                style={{
                  transformStyle: 'preserve-3d',
                  transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
                  minHeight: '140px',
                }}
              >
                {/* Front */}
                <div
                  className="absolute inset-0 bg-white border-2 border-blue-200 rounded-lg p-4 flex flex-col items-center justify-center text-center"
                  style={{ backfaceVisibility: 'hidden' }}
                >
                  <div className="text-xs text-gray-700 leading-relaxed">{currentCard.front}</div>
                  <div className="text-[10px] text-gray-400 mt-3">Tap to flip</div>
                </div>

                {/* Back */}
                <div
                  className="absolute inset-0 bg-blue-50 border-2 border-blue-300 rounded-lg p-4 flex flex-col items-center justify-center text-center"
                  style={{
                    backfaceVisibility: 'hidden',
                    transform: 'rotateY(180deg)',
                  }}
                >
                  <div className="text-xs text-gray-700 leading-relaxed">{currentCard.back}</div>
                  <div className="text-[10px] text-gray-400 mt-3">Tap to flip back</div>
                </div>
              </div>
            </div>

            {/* Card navigation dots */}
            <div className="flex items-center justify-center gap-1.5">
              {cards.map((_, i) => (
                <button
                  key={i}
                  onClick={() => {
                    emitCardTransition('dot');
                    setCurrentIndex(i);
                    setFlipped(false);
                  }}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === currentIndex ? 'bg-blue-600' : 'bg-gray-300'
                  }`}
                />
              ))}
            </div>

            {/* Navigation arrows */}
            <div className="flex items-center justify-between px-4">
              <button
                onClick={handlePrev}
                disabled={currentIndex === 0}
                className="text-xs text-blue-600 disabled:text-gray-300"
              >
                &larr; Prev
              </button>
              <span className="text-xs text-gray-500">
                Card {currentIndex + 1} of {cards.length}
              </span>
              <button
                onClick={handleNext}
                disabled={currentIndex === cards.length - 1}
                className="text-xs text-blue-600 disabled:text-gray-300"
              >
                Next &rarr;
              </button>
            </div>

            {/* Remove card */}
            <div className="text-center">
              <button
                onClick={() => handleDeleteCard(currentCard.id)}
                className="text-[10px] text-red-500 hover:text-red-700 inline-flex items-center gap-1"
              >
                <Trash2 size={10} /> Remove card
              </button>
            </div>
          </>
        )}

        {/* Notes */}
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            Add a note (optional)
          </label>
          <textarea
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            placeholder="Any notes about these flashcards..."
            className="w-full text-xs border border-gray-300 rounded p-2 h-14 resize-none"
          />
        </div>
      </div>

      {/* Actions */}
      <div className="px-3 py-2 border-t border-gray-200 space-y-1.5">
        <button
          onClick={handleSave}
          disabled={saved}
          className={`w-full text-xs px-3 py-2 rounded-lg transition-colors ${
            saved
              ? 'bg-green-50 text-green-600 border border-green-200'
              : 'bg-blue-600 text-white hover:bg-blue-700'
          }`}
        >
          {saved ? '\u2713 Saved to My Reviews' : 'Save to My Reviews'}
        </button>
        <div className="flex gap-2">
          <button
            onClick={() => navigate('/student/review-queue')}
            className="flex-1 text-xs text-blue-600 border border-blue-300 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
          >
            Go to Review Queue
          </button>
          <button
            onClick={onComplete}
            className="flex-1 text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
