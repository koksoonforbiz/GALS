import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../lib/api';
import type { SaveForReviewInput } from '../types';

interface InterrogativeElaborationViewProps {
  selectedText: string;
  courseId: string;
  contentId: string | null;
  pageType: string;
  contentTitle: string;
  onComplete: () => void;
  onBack: () => void;
  onSaveForReview: (data: SaveForReviewInput) => void;
}

interface ElaborationQuestion {
  question: string;
  type: 'why' | 'how';
}

interface ElaborationEvaluation {
  rating: string;
  addressedPoints: string[];
  missedPoints: string[];
  feedback: string;
  modelElaboration: string;
}

interface QuestionResult {
  elaboration: string;
  evaluation: ElaborationEvaluation;
}

type Phase = 'loading' | 'question' | 'evaluating' | 'feedback' | 'complete' | 'error';

const RATING_STYLES: Record<string, { bg: string; text: string; label: string }> = {
  Strong: { bg: 'bg-green-100', text: 'text-green-700', label: 'Strong' },
  Developing: { bg: 'bg-yellow-100', text: 'text-yellow-700', label: 'Developing' },
  'Needs Improvement': { bg: 'bg-red-100', text: 'text-red-700', label: 'Needs Improvement' },
};

export function InterrogativeElaborationView({
  selectedText,
  courseId,
  contentId,
  pageType,
  contentTitle,
  onComplete,
  onBack,
  onSaveForReview,
}: InterrogativeElaborationViewProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [interventionId, setInterventionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ElaborationQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [elaborationText, setElaborationText] = useState('');
  const [results, setResults] = useState<Record<number, QuestionResult>>({});
  const [showModelAnswer, setShowModelAnswer] = useState(false);
  const [isRevising, setIsRevising] = useState(false);
  const [previousAttempt, setPreviousAttempt] = useState('');
  const [errorMsg, setErrorMsg] = useState('');
  const [saved, setSaved] = useState(false);
  const [userNotes, setUserNotes] = useState('');
  const initialGenDone = useRef(false);

  // Generate elaboration questions
  const generate = useCallback(async () => {
    setPhase('loading');
    try {
      const result = await api.post<{
        interventionId: string;
        questions: ElaborationQuestion[];
      }>('/learning-interventions/interrogative-elaboration/generate', {
        selectedText,
        courseId,
        contentId: contentId || undefined,
        pageType,
        questionCount: 4,
      });
      setInterventionId(result.interventionId);
      setQuestions(result.questions);
      setPhase('question');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate elaboration questions');
      setPhase('error');
    }
  }, [selectedText, courseId, contentId, pageType]);

  // Only generate once on mount (not on every selectedText change)
  useEffect(() => {
    if (initialGenDone.current) return;
    initialGenDone.current = true;
    void generate();
  }, [generate]);

  const handleSubmitElaboration = async () => {
    if (!interventionId || elaborationText.trim().length < 50) return;

    setPhase('evaluating');
    try {
      const evaluation = await api.post<ElaborationEvaluation>(
        `/learning-interventions/interrogative-elaboration/${interventionId}/evaluate`,
        {
          questionIndex: currentIndex,
          elaboration: elaborationText,
        },
      );

      setResults((prev) => ({
        ...prev,
        [currentIndex]: {
          elaboration: elaborationText,
          evaluation,
        },
      }));
      setPhase('feedback');
      setShowModelAnswer(false);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to evaluate elaboration');
      setPhase('error');
    }
  };

  const handleRevise = () => {
    const currentResult = results[currentIndex];
    if (currentResult) {
      setPreviousAttempt(currentResult.elaboration);
    }
    setElaborationText('');
    setIsRevising(true);
    setPhase('question');
  };

  const handleNext = () => {
    if (currentIndex < questions.length - 1) {
      setCurrentIndex((i) => i + 1);
      setElaborationText('');
      setIsRevising(false);
      setPreviousAttempt('');
      setShowModelAnswer(false);
      setPhase('question');
    } else {
      // All questions done — complete
      void completeSession();
    }
  };

  const completeSession = async () => {
    if (!interventionId) return;
    try {
      await api.post(
        `/learning-interventions/interrogative-elaboration/${interventionId}/complete`,
      );
    } catch {
      // non-critical — session still usable
    }
    setPhase('complete');
  };

  const handleSave = () => {
    if (!interventionId) return;

    const elaborations = Object.entries(results).map(([idx, r]) => {
      const i = Number(idx);
      const q = questions[i]!;
      return {
        questionIndex: i,
        question: q.question,
        questionType: q.type,
        userElaboration: r.elaboration,
        rating: r.evaluation.rating,
        addressedPoints: r.evaluation.addressedPoints,
        missedPoints: r.evaluation.missedPoints,
        feedback: r.evaluation.feedback,
        modelElaboration: r.evaluation.modelElaboration,
      };
    });

    const strong = elaborations.filter((e) => e.rating === 'Strong').length;
    const developing = elaborations.filter((e) => e.rating === 'Developing').length;
    const needsImprovement = elaborations.filter((e) => e.rating === 'Needs Improvement').length;

    onSaveForReview({
      interventionId,
      interventionType: 'INTERROGATIVE_ELABORATION',
      title: `Elaboration - ${contentTitle || 'Untitled'}`,
      selectedText,
      savedData: {
        questions: questions.map((q) => ({
          question: q.question,
          type: q.type,
        })),
        elaborations,
        overallSummary: { strong, developing, needsImprovement },
        completedAt: new Date().toISOString(),
      },
    });
    setSaved(true);
  };

  const handleRetry = () => {
    setQuestions([]);
    setCurrentIndex(0);
    setElaborationText('');
    setResults({});
    setSaved(false);
    setUserNotes('');
    setIsRevising(false);
    setPreviousAttempt('');
    setShowModelAnswer(false);
    void generate();
  };

  // ─── Loading Phase ──────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-2xl mb-3 animate-pulse">{'\uD83D\uDCA1'}</div>
        <p className="text-sm text-gray-600">Generating elaboration questions...</p>
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

  // ─── Evaluating Phase ────────────────────────────────────
  if (phase === 'evaluating') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-2xl mb-3 animate-pulse">{'\uD83E\uDDE0'}</div>
        <p className="text-sm text-gray-600">Evaluating your response...</p>
        <p className="text-xs text-gray-400 mt-2">Comparing against key points</p>
      </div>
    );
  }

  // ─── Question Phase ─────────────────────────────────────
  if (phase === 'question') {
    const q = questions[currentIndex]!;
    if (!q) return null;
    const charCount = elaborationText.length;
    const isValid = charCount >= 50;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between mb-1">
            <button onClick={onBack} className="text-xs text-blue-600 hover:text-blue-800">
              &larr; Back to chat
            </button>
            <span className="text-xs font-medium text-gray-600">Interrogative Elaboration</span>
          </div>
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>
              Question {currentIndex + 1} of {questions.length}
            </span>
            <span
              className={`px-1.5 py-0.5 rounded-full text-[10px] font-medium ${
                q.type === 'why' ? 'bg-blue-100 text-blue-700' : 'bg-green-100 text-green-700'
              }`}
            >
              {q.type.toUpperCase()}
            </span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-1.5">
            <div
              className="bg-blue-600 h-1.5 rounded-full transition-all"
              style={{
                width: `${((currentIndex + 1) / questions.length) * 100}%`,
              }}
            />
          </div>
        </div>

        {/* Question content */}
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-sm font-medium text-gray-800 mb-3">{q.question}</p>

          {/* Previous attempt (revision mode) */}
          {isRevising && previousAttempt && (
            <div className="mb-3 text-xs bg-gray-50 border border-gray-200 rounded p-2">
              <div className="text-gray-500 font-medium mb-1">Previous attempt:</div>
              <div className="text-gray-600 italic">{previousAttempt}</div>
            </div>
          )}

          <textarea
            value={elaborationText}
            onChange={(e) => setElaborationText(e.target.value)}
            placeholder="Explain your reasoning in detail (min 50 characters)..."
            className="w-full text-xs border border-gray-300 rounded-lg p-2 h-32 resize-none focus:outline-none focus:border-blue-400"
          />
          <div
            className={`text-[10px] text-right mt-1 ${
              isValid ? 'text-green-600' : 'text-gray-400'
            }`}
          >
            {charCount}/50 characters
          </div>
        </div>

        {/* Submit button */}
        <div className="px-3 py-2 border-t border-gray-200">
          <button
            onClick={handleSubmitElaboration}
            disabled={!isValid}
            className="w-full text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Submit Elaboration
          </button>
        </div>
      </div>
    );
  }

  // ─── Feedback Phase ─────────────────────────────────────
  if (phase === 'feedback') {
    const currentResult = results[currentIndex];
    if (!currentResult) return null;
    const { evaluation } = currentResult;
    const ratingStyle = RATING_STYLES[evaluation.rating] || RATING_STYLES['Developing']!;
    const isLast = currentIndex === questions.length - 1;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between mb-1">
            <button onClick={onBack} className="text-xs text-blue-600 hover:text-blue-800">
              &larr; Back to chat
            </button>
            <span className="text-xs font-medium text-gray-600">Interrogative Elaboration</span>
          </div>
          <div className="text-xs text-gray-500">
            Question {currentIndex + 1} of {questions.length} - Feedback
          </div>
        </div>

        {/* Feedback content */}
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Rating badge */}
          <div className="flex items-center gap-2">
            <span
              className={`px-2 py-1 rounded-full text-xs font-medium ${ratingStyle.bg} ${ratingStyle.text}`}
            >
              {evaluation.rating === 'Strong' && '\uD83D\uDFE2 '}
              {evaluation.rating === 'Developing' && '\uD83D\uDFE1 '}
              {evaluation.rating === 'Needs Improvement' && '\uD83D\uDD34 '}
              {ratingStyle.label}
            </span>
          </div>

          {/* Addressed points */}
          {evaluation.addressedPoints.length > 0 && (
            <div>
              <div className="text-xs font-medium text-green-700 mb-1">Addressed:</div>
              <ul className="space-y-0.5">
                {evaluation.addressedPoints.map((p, i) => (
                  <li key={i} className="text-xs text-gray-700 flex items-start gap-1">
                    <span className="text-green-600 shrink-0">{'\u2705'}</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Missed points */}
          {evaluation.missedPoints.length > 0 && (
            <div>
              <div className="text-xs font-medium text-orange-700 mb-1">To explore further:</div>
              <ul className="space-y-0.5">
                {evaluation.missedPoints.map((p, i) => (
                  <li key={i} className="text-xs text-gray-700 flex items-start gap-1">
                    <span className="text-orange-500 shrink-0">{'\u2192'}</span>
                    <span>{p}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Feedback card */}
          <div className="bg-blue-50 border border-blue-200 rounded p-2 text-xs text-gray-700">
            {evaluation.feedback}
          </div>

          {/* Model answer (collapsible) */}
          <div>
            <button
              onClick={() => setShowModelAnswer(!showModelAnswer)}
              className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1"
            >
              {'\uD83D\uDCDD'} {showModelAnswer ? 'Hide' : 'See'} model answer
              <span className="text-[10px]">{showModelAnswer ? '\u25B2' : '\u25BC'}</span>
            </button>
            {showModelAnswer && (
              <div className="mt-1 bg-gray-50 border border-gray-200 rounded p-2 text-xs text-gray-600 italic">
                {evaluation.modelElaboration}
              </div>
            )}
          </div>
        </div>

        {/* Action buttons */}
        <div className="px-3 py-2 border-t border-gray-200 flex gap-2">
          <button
            onClick={handleRevise}
            className="flex-1 text-xs text-gray-600 border border-gray-300 px-3 py-2 rounded-lg hover:bg-gray-50 transition-colors"
          >
            {'\u270F\uFE0F'} Revise
          </button>
          <button
            onClick={handleNext}
            className="flex-1 text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {isLast ? 'Complete' : 'Next \u2192'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Complete Phase ─────────────────────────────────────
  const allResults = Object.entries(results);
  const strong = allResults.filter(([, r]) => r.evaluation.rating === 'Strong').length;
  const developing = allResults.filter(([, r]) => r.evaluation.rating === 'Developing').length;
  const needsImprovement = allResults.filter(
    ([, r]) => r.evaluation.rating === 'Needs Improvement',
  ).length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Completion Header */}
      <div className="px-3 py-3 border-b border-gray-100 bg-gray-50 text-center">
        <div className="text-lg mb-1">{'\uD83C\uDF89'}</div>
        <div className="text-sm font-semibold text-gray-800">Elaboration Complete!</div>
        <div className="text-xs text-gray-600 mt-1">
          {strong > 0 && <span className="inline-block mr-2">{strong} Strong</span>}
          {developing > 0 && <span className="inline-block mr-2">{developing} Developing</span>}
          {needsImprovement > 0 && (
            <span className="inline-block">{needsImprovement} Needs Improvement</span>
          )}
        </div>

        {/* Question summary */}
        <div className="flex items-center justify-center gap-1.5 mt-2 flex-wrap">
          {questions.map((q, i) => {
            const r = results[i];
            const rating = r?.evaluation.rating || '';
            const dotColor =
              rating === 'Strong'
                ? 'bg-green-100 text-green-700'
                : rating === 'Developing'
                  ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-red-100 text-red-700';
            const typeBadge = q.type === 'why' ? 'WHY' : 'HOW';

            return (
              <div
                key={i}
                className={`text-[10px] px-2 py-1 rounded-full flex items-center gap-1 ${dotColor}`}
              >
                <span>Q{i + 1}</span>
                <span className="opacity-70">({typeBadge})</span>
                <span>
                  {rating === 'Strong' && '\uD83D\uDFE2'}
                  {rating === 'Developing' && '\uD83D\uDFE1'}
                  {rating === 'Needs Improvement' && '\uD83D\uDD34'}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Notes input */}
      <div className="flex-1 overflow-y-auto p-3">
        <div>
          <label className="text-xs font-medium text-gray-600 block mb-1">
            Add a note (optional)
          </label>
          <textarea
            value={userNotes}
            onChange={(e) => setUserNotes(e.target.value)}
            placeholder="Reflect on what you learned..."
            className="w-full text-xs border border-gray-300 rounded p-2 h-16 resize-none"
          />
        </div>
      </div>

      {/* Action buttons */}
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
            onClick={handleRetry}
            className="flex-1 text-xs text-gray-600 border border-gray-300 px-3 py-1.5 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Try Again
          </button>
          <button
            onClick={onComplete}
            className="flex-1 text-xs text-blue-600 border border-blue-300 px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
