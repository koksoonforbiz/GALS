import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../../../lib/api';
import type { SaveForReviewInput } from '../types';

interface DistributedPracticeViewProps {
  selectedText: string;
  courseId: string;
  contentId: string | null;
  pageType: string;
  contentTitle: string;
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

  const generate = useCallback(async () => {
    setPhase('loading');
    try {
      const result = await api.post<{
        interventionId: string;
        cards: FlashcardItem[];
        totalCreated: number;
      }>('/learning-interventions/distributed-practice/generate', {
        selectedText,
        courseId,
        contentId: contentId || undefined,
        pageType,
        cardCount: 5,
      });
      setInterventionId(result.interventionId);
      setCards(result.cards);
      setPhase('preview');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate flashcards');
      setPhase('error');
    }
  }, [selectedText, courseId, contentId, pageType]);

  useEffect(() => {
    if (initialGenDone.current) return;
    initialGenDone.current = true;
    void generate();
  }, [generate]);

  const currentCard = cards[currentIndex];

  const handlePrev = () => {
    setFlipped(false);
    setCurrentIndex((i) => Math.max(0, i - 1));
  };

  const handleNext = () => {
    setFlipped(false);
    setCurrentIndex((i) => Math.min(cards.length - 1, i + 1));
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
        <div className="text-2xl mb-3 animate-pulse">{'\uD83C\uDCCF'}</div>
        <p className="text-sm text-gray-600">Creating flashcards...</p>
        <p className="text-xs text-gray-400 mt-2">This may take a few seconds</p>
      </div>
    );
  }

  // ─── Error Phase ────────────────────────────────────────
  if (phase === 'error') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-2xl mb-3">{'\u26A0\uFE0F'}</div>
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
        <div className="text-2xl mb-3">{'\uD83D\uDCED'}</div>
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
              onClick={() => setFlipped(!flipped)}
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
                className="text-[10px] text-red-500 hover:text-red-700"
              >
                {'\uD83D\uDDD1'} Remove card
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
