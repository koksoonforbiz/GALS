import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../lib/api';
import type { SaveForReviewInput } from '../types';
import { FlaskConical, Trophy, AlertTriangle } from 'lucide-react';

interface PracticeTestingViewProps {
  selectedText: string;
  courseId: string;
  contentId: string | null;
  pageType: string;
  contentTitle: string;
  onComplete: () => void;
  onBack: () => void;
  onSaveForReview: (data: SaveForReviewInput) => void;
}

interface GeneratedQuestion {
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[];
}

interface GradedAnswer {
  questionIndex: number;
  question: string;
  type: 'mcq' | 'short_answer';
  userAnswer: string;
  correctAnswer: string;
  correct: boolean;
  explanation: string;
  feedback?: string;
  options?: string[];
}

type Phase = 'loading' | 'quiz' | 'feedback' | 'results' | 'error';

export function PracticeTestingView({
  selectedText,
  courseId,
  contentId,
  pageType,
  contentTitle,
  onComplete,
  onBack,
  onSaveForReview,
}: PracticeTestingViewProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [interventionId, setInterventionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [userAnswers, setUserAnswers] = useState<Record<number, string>>({});
  const [gradedResults, setGradedResults] = useState<GradedAnswer[]>([]);
  const [score, setScore] = useState(0);
  const [errorMsg, setErrorMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [saved, setSaved] = useState(false);
  const [userNotes, setUserNotes] = useState('');
  const [expandedResult, setExpandedResult] = useState<number | null>(null);
  const initialGenDone = useRef(false);

  // Generate practice test
  const generate = useCallback(async () => {
    setPhase('loading');
    try {
      const result = await api.post<{
        interventionId: string;
        questions: GeneratedQuestion[];
      }>('/learning-interventions/practice-testing/generate', {
        selectedText,
        courseId,
        contentId: contentId || undefined,
        pageType,
        questionCount: 5,
      });
      setInterventionId(result.interventionId);
      setQuestions(result.questions);
      setPhase('quiz');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate practice test');
      setPhase('error');
    }
  }, [selectedText, courseId, contentId, pageType]);

  // Only generate once on mount (not on every selectedText change)
  useEffect(() => {
    if (initialGenDone.current) return;
    initialGenDone.current = true;
    void generate();
  }, [generate]);

  const handleAnswerSelect = (answer: string) => {
    setUserAnswers((prev) => ({ ...prev, [currentIndex]: answer }));
  };

  const handleSubmitAnswer = async () => {
    if (currentIndex < questions.length - 1) {
      // Move to next question
      setCurrentIndex((i) => i + 1);
      return;
    }

    // All questions answered — submit
    if (!interventionId) return;
    setSubmitting(true);
    try {
      const answers = questions.map((_, i) => ({
        questionIndex: i,
        answer: userAnswers[i] || '',
      }));

      const result = await api.post<{
        score: number;
        totalQuestions: number;
        results: GradedAnswer[];
      }>(`/learning-interventions/practice-testing/${interventionId}/submit`, {
        answers,
      });

      setGradedResults(result.results);
      setScore(result.score);
      setPhase('results');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to submit answers');
      setPhase('error');
    } finally {
      setSubmitting(false);
    }
  };

  const handleSave = () => {
    if (!interventionId) return;
    onSaveForReview({
      interventionId,
      interventionType: 'PRACTICE_TESTING',
      title: `Practice Test - ${contentTitle || 'Untitled'}`,
      selectedText,
      savedData: {
        questions: gradedResults.map((r) => ({
          question: r.question,
          type: r.type,
          userAnswer: r.userAnswer,
          correctAnswer: r.correctAnswer,
          correct: r.correct,
          explanation: r.explanation,
          options: r.options,
          answer: r.correctAnswer,
        })),
        score,
        totalQuestions: questions.length,
        completedAt: new Date().toISOString(),
      },
    });
    setSaved(true);
  };

  const handleRetry = () => {
    setQuestions([]);
    setCurrentIndex(0);
    setUserAnswers({});
    setGradedResults([]);
    setScore(0);
    setSaved(false);
    setUserNotes('');
    setExpandedResult(null);
    void generate();
  };

  // ─── Loading Phase ──────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <FlaskConical size={28} className="text-blue-500 mb-3 animate-pulse" />
        <p className="text-sm text-gray-600">Generating questions from your selected text...</p>
        <p className="text-xs text-gray-400 mt-2">This may take a few seconds</p>
        <div className="w-48 bg-gray-200 rounded-full h-1.5 mt-4 overflow-hidden">
          <div
            className="bg-blue-500 h-1.5 rounded-full animate-[indeterminate_1.5s_ease-in-out_infinite]"
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

  // ─── Quiz Phase ─────────────────────────────────────────
  if (phase === 'quiz') {
    const q = questions[currentIndex]!;
    if (!q) return null;
    const answered = userAnswers[currentIndex] !== undefined && userAnswers[currentIndex] !== '';
    const isLast = currentIndex === questions.length - 1;

    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Progress bar */}
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
          <div className="flex items-center justify-between text-xs text-gray-500 mb-1">
            <span>
              Question {currentIndex + 1} of {questions.length}
            </span>
            <span>{q.type === 'mcq' ? 'Multiple Choice' : 'Short Answer'}</span>
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

        {/* Question */}
        <div className="flex-1 overflow-y-auto p-3">
          <p className="text-sm font-medium text-gray-800 mb-3">{q.question}</p>

          {q.type === 'mcq' && q.options ? (
            <div className="space-y-2">
              {q.options.map((opt, i) => {
                const letter = opt.charAt(0);
                const isSelected = userAnswers[currentIndex] === letter;
                return (
                  <button
                    key={i}
                    onClick={() => handleAnswerSelect(letter)}
                    className={`w-full text-left text-xs px-3 py-2 rounded-lg border transition-colors ${
                      isSelected
                        ? 'border-blue-500 bg-blue-50 text-blue-800'
                        : 'border-gray-200 hover:border-gray-300 text-gray-700'
                    }`}
                  >
                    {opt}
                  </button>
                );
              })}
            </div>
          ) : (
            <textarea
              value={userAnswers[currentIndex] || ''}
              onChange={(e) => handleAnswerSelect(e.target.value)}
              placeholder="Type your answer..."
              className="w-full text-xs border border-gray-300 rounded-lg p-2 h-24 resize-none focus:outline-none focus:border-blue-400"
            />
          )}
        </div>

        {/* Submit button */}
        <div className="px-3 py-2 border-t border-gray-200">
          <button
            onClick={handleSubmitAnswer}
            disabled={!answered || submitting}
            className="w-full text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            {submitting ? 'Submitting...' : isLast ? 'Submit All Answers' : 'Next \u2192'}
          </button>
        </div>
      </div>
    );
  }

  // ─── Results Phase ──────────────────────────────────────
  const correctCount = gradedResults.filter((r) => r.correct).length;
  const totalQuestions = gradedResults.length;

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Score Header */}
      <div className="px-3 py-3 border-b border-gray-100 bg-gray-50 text-center">
        <div className="mb-1 flex justify-center">
          <Trophy size={22} className="text-yellow-500" />
        </div>
        <div className="text-sm font-semibold text-gray-800">Practice Test Complete!</div>
        <div className="text-lg font-bold text-blue-600 mt-1">
          {correctCount}/{totalQuestions} ({score}%)
        </div>
        {/* Progress bar */}
        <div className="w-full bg-gray-200 rounded-full h-2 mt-2">
          <div
            className={`h-2 rounded-full transition-all ${
              score >= 80 ? 'bg-green-500' : score >= 50 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${score}%` }}
          />
        </div>
        {/* Question summary dots */}
        <div className="flex items-center justify-center gap-1 mt-2">
          {gradedResults.map((r, i) => (
            <button
              key={i}
              onClick={() => setExpandedResult(expandedResult === i ? null : i)}
              className={`text-xs w-6 h-6 rounded-full flex items-center justify-center ${
                r.correct ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
              }`}
              title={`Q${i + 1}: ${r.correct ? 'Correct' : 'Incorrect'}`}
            >
              Q{i + 1}
            </button>
          ))}
        </div>
      </div>

      {/* Detailed results */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {gradedResults.map((r, i) => (
          <div key={i} className="border border-gray-200 rounded-lg overflow-hidden">
            <button
              onClick={() => setExpandedResult(expandedResult === i ? null : i)}
              className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-gray-50 transition-colors"
            >
              <span className={`text-xs ${r.correct ? 'text-green-600' : 'text-red-600'}`}>
                {r.correct ? '\u2713' : '\u2717'}
              </span>
              <span className="text-xs text-gray-800 flex-1 truncate">{r.question}</span>
              <span className="text-xs text-gray-400">
                {expandedResult === i ? '\u25B2' : '\u25BC'}
              </span>
            </button>
            {expandedResult === i && (
              <div className="px-3 pb-2 text-xs space-y-1 border-t border-gray-100 pt-2">
                <div className={`${r.correct ? 'text-green-700' : 'text-red-600'}`}>
                  Your answer: {r.userAnswer || '(no answer)'}
                </div>
                {!r.correct && (
                  <div className="text-green-700">Correct answer: {r.correctAnswer}</div>
                )}
                {r.feedback ? (
                  <div className="text-gray-600 bg-gray-50 rounded p-2 mt-1">{r.feedback}</div>
                ) : (
                  <div className="text-gray-500 italic">{r.explanation}</div>
                )}
              </div>
            )}
          </div>
        ))}

        {/* Notes input */}
        <div className="mt-3">
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
