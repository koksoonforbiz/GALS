import { useState, useEffect } from 'react';
import { api } from '../lib/api';

// ─── Types ─────────────────────────────────────────────────

interface PracticeTestQuestion {
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[];
}

interface AnswerResult {
  questionIndex: number;
  userAnswer: string;
  isCorrect: boolean;
  correctAnswer: string;
  explanation: string;
}

interface GenerateResponse {
  interventionId: string;
  practiceTestId: string;
  questions: PracticeTestQuestion[];
}

interface SubmitResponse {
  practiceTestId: string;
  score: number;
  totalQuestions: number;
  percentage: number;
  results: AnswerResult[];
}

type ViewState = 'loading' | 'quiz' | 'reviewing' | 'complete' | 'error';

interface PracticeTestingViewProps {
  selectedText: string;
  courseId: string;
  contentId: string;
  pageType?: string; // "lesson", "quiz", "reading", etc.
  onComplete: () => void;
  onBack: () => void;
}

// ─── Component ─────────────────────────────────────────────

export function PracticeTestingView({
  selectedText,
  courseId,
  contentId,
  pageType,
  onComplete,
  onBack,
}: PracticeTestingViewProps) {
  const [state, setState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);

  // Quiz data
  const [practiceTestId, setPracticeTestId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<PracticeTestQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState<Map<number, string>>(new Map());
  const [currentAnswer, setCurrentAnswer] = useState('');

  // Review data (after submitting one answer) - reserved for future immediate feedback
  const [_lastResult, _setLastResult] = useState<AnswerResult | null>(null);
  void _lastResult; // Will be used when per-question feedback is implemented

  // Complete data (after all answers submitted)
  const [finalResults, setFinalResults] = useState<SubmitResponse | null>(null);

  // ─── Generate Questions on Mount ─────────────────────────
  useEffect(() => {
    generateQuestions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const generateQuestions = async () => {
    setState('loading');
    setError(null);

    try {
      const response = await api.post<GenerateResponse>(
        '/learning-interventions/practice-testing/generate',
        {
          selectedText,
          courseId,
          contentId,
          pageType,
          questionCount: 5,
        },
      );

      setPracticeTestId(response.practiceTestId);
      setQuestions(response.questions);
      setCurrentQuestionIndex(0);
      setAnswers(new Map());
      setCurrentAnswer('');
      setState('quiz');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions');
      setState('error');
    }
  };

  // ─── Submit Current Answer ───────────────────────────────
  const handleSubmitAnswer = async () => {
    if (!currentAnswer.trim() || !practiceTestId) return;

    // Store the answer
    const newAnswers = new Map(answers);
    newAnswers.set(currentQuestionIndex, currentAnswer);
    setAnswers(newAnswers);

    // If this is the last question, submit all answers
    if (currentQuestionIndex === questions.length - 1) {
      await submitAllAnswers(newAnswers);
    } else {
      // Show review for current answer (we need to submit to get feedback)
      // For now, we'll batch submit at the end. Show a "correct/incorrect" preview.
      setState('reviewing');
    }
  };

  // ─── Move to Next Question ───────────────────────────────
  const handleNextQuestion = () => {
    _setLastResult(null);
    setCurrentAnswer('');
    setCurrentQuestionIndex((prev) => prev + 1);
    setState('quiz');
  };

  // ─── Submit All Answers ──────────────────────────────────
  const submitAllAnswers = async (allAnswers: Map<number, string>) => {
    if (!practiceTestId) return;

    setState('loading');

    try {
      const answersArray = Array.from(allAnswers.entries()).map(([questionIndex, answer]) => ({
        questionIndex,
        answer,
      }));

      const response = await api.post<SubmitResponse>(
        `/learning-interventions/practice-testing/${practiceTestId}/submit`,
        { answers: answersArray },
      );

      setFinalResults(response);
      setState('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit answers');
      setState('error');
    }
  };

  // ─── Handle "Review" state (intermediate feedback) ───────
  // Since we're batching submissions, we'll show a simpler review
  const handleContinueAfterReview = () => {
    if (currentQuestionIndex < questions.length - 1) {
      handleNextQuestion();
    } else {
      // Last question - submit all
      submitAllAnswers(answers);
    }
  };

  // ─── Back to Chat Header ─────────────────────────────────
  const [showExitConfirm, setShowExitConfirm] = useState(false);

  const handleBack = () => {
    // Show confirmation if mid-quiz (has questions but not complete)
    if (state === 'quiz' || state === 'reviewing') {
      setShowExitConfirm(true);
    } else {
      onBack();
    }
  };

  const BackHeader = () => (
    <div className="flex items-center gap-2 pb-3 mb-4 border-b border-gray-200">
      <button
        onClick={handleBack}
        className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to chat
      </button>
      <span className="text-sm font-medium text-gray-700">Practice Testing</span>
    </div>
  );

  // ─── Exit Confirmation Dialog ─────────────────────────────
  if (showExitConfirm) {
    return (
      <div className="w-full">
        <div className="flex flex-col items-center justify-center py-8">
          <div className="text-amber-500 text-3xl mb-3">!</div>
          <p className="text-sm text-gray-700 text-center mb-1 font-medium">Leave practice test?</p>
          <p className="text-xs text-gray-500 text-center mb-4">Your progress will be lost.</p>
          <div className="flex gap-2 w-full">
            <button
              onClick={() => setShowExitConfirm(false)}
              className="flex-1 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50"
            >
              Stay
            </button>
            <button
              onClick={onBack}
              className="flex-1 py-2 text-sm font-medium text-white bg-red-500 rounded-lg hover:bg-red-600"
            >
              Leave
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ─── Render Based on State ───────────────────────────────

  if (state === 'loading') {
    return (
      <div className="w-full">
        <BackHeader />
        <div className="flex flex-col items-center justify-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4" />
          <p className="text-gray-600 text-sm text-center">
            {questions.length === 0
              ? 'Generating questions from your selected text...'
              : 'Submitting your answers...'}
          </p>
        </div>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="w-full">
        <BackHeader />
        <div className="flex flex-col items-center justify-center py-8">
          <div className="text-red-500 text-4xl mb-4">!</div>
          <p className="text-gray-700 mb-4 text-sm text-center">{error}</p>
          <button
            onClick={generateQuestions}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (state === 'quiz') {
    const question = questions[currentQuestionIndex];
    if (!question) return null;

    return (
      <div className="w-full">
        <BackHeader />
        <div className="space-y-4">
          {/* Progress Bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{
                  width: `${((currentQuestionIndex + 1) / questions.length) * 100}%`,
                }}
              />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {currentQuestionIndex + 1}/{questions.length}
            </span>
          </div>

          {/* Question */}
          <div className="bg-white border border-gray-200 rounded-lg p-4">
            <p className="text-sm text-gray-900 mb-4">{question.question}</p>

            {question.type === 'mcq' && question.options ? (
              <div className="space-y-2">
                {question.options.map((option, idx) => {
                  const letter = option.charAt(0);
                  const isSelected = currentAnswer === letter;

                  return (
                    <button
                      key={idx}
                      onClick={() => setCurrentAnswer(letter)}
                      className={`w-full text-left p-3 rounded-lg border-2 transition-all text-sm ${
                        isSelected
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300'
                      }`}
                    >
                      {option}
                    </button>
                  );
                })}
              </div>
            ) : (
              <textarea
                value={currentAnswer}
                onChange={(e) => setCurrentAnswer(e.target.value)}
                placeholder="Type your answer here..."
                className="w-full p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                rows={3}
              />
            )}
          </div>

          {/* Actions */}
          <button
            onClick={handleSubmitAnswer}
            disabled={!currentAnswer.trim()}
            className={`w-full py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              currentAnswer.trim()
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            {currentQuestionIndex === questions.length - 1
              ? 'Submit & See Results'
              : 'Submit Answer'}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'reviewing') {
    // Simple intermediate review - just show they answered and can continue
    const question = questions[currentQuestionIndex];
    const userAnswer = answers.get(currentQuestionIndex) || currentAnswer;

    return (
      <div className="w-full">
        <BackHeader />
        <div className="space-y-4">
          {/* Progress Bar */}
          <div className="flex items-center gap-2">
            <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
              <div
                className="h-full bg-blue-600 transition-all duration-300"
                style={{
                  width: `${((currentQuestionIndex + 1) / questions.length) * 100}%`,
                }}
              />
            </div>
            <span className="text-xs text-gray-500 whitespace-nowrap">
              {currentQuestionIndex + 1}/{questions.length}
            </span>
          </div>

          {/* Answer Recorded */}
          <div className="bg-blue-50 border border-blue-200 rounded-lg p-4">
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xl">ok</span>
              <span className="font-medium text-blue-800 text-sm">Answer Recorded</span>
            </div>
            <p className="text-gray-700 mb-2 text-sm">
              <strong>Q:</strong> {question?.question}
            </p>
            <p className="text-gray-700 text-sm">
              <strong>A:</strong> {userAnswer}
            </p>
            <p className="text-xs text-gray-500 mt-3">Feedback after all questions.</p>
          </div>

          {/* Actions */}
          <button
            onClick={handleContinueAfterReview}
            className="w-full py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            {currentQuestionIndex === questions.length - 1 ? 'See Results' : 'Next Question'}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'complete' && finalResults) {
    const { score, totalQuestions, percentage, results } = finalResults;

    // Determine score color
    let scoreColor = 'text-green-600';
    if (percentage < 50) {
      scoreColor = 'text-orange-600';
    } else if (percentage < 80) {
      scoreColor = 'text-blue-600';
    }

    return (
      <div className="w-full">
        <BackHeader />
        <div className="space-y-4">
          {/* Score Summary */}
          <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-lg p-4 text-center">
            <h3 className={`text-2xl font-bold ${scoreColor} mb-1`}>
              {score}/{totalQuestions}
            </h3>
            <p className="text-gray-600 text-sm">
              You scored <strong>{percentage}%</strong>
            </p>

            {/* Progress Ring */}
            <div className="mt-4 flex justify-center">
              <div className="relative w-16 h-16">
                <svg className="w-full h-full transform -rotate-90">
                  <circle cx="32" cy="32" r="28" stroke="#e5e7eb" strokeWidth="6" fill="none" />
                  <circle
                    cx="32"
                    cy="32"
                    r="28"
                    stroke={percentage >= 80 ? '#22c55e' : percentage >= 50 ? '#3b82f6' : '#f97316'}
                    strokeWidth="6"
                    fill="none"
                    strokeDasharray={`${(percentage / 100) * 175.9} 175.9`}
                    className="transition-all duration-500"
                  />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                  <span className="text-sm font-bold text-gray-700">{percentage}%</span>
                </div>
              </div>
            </div>
          </div>

          {/* Detailed Results (scrollable) */}
          <div className="space-y-3 max-h-60 overflow-y-auto">
            <h4 className="font-medium text-gray-900 text-sm sticky top-0 bg-white">
              Question Review
            </h4>
            {results.map((result, idx) => {
              const question = questions[result.questionIndex];
              return (
                <div
                  key={idx}
                  className={`border rounded-lg p-3 ${
                    result.isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                  }`}
                >
                  <div className="flex items-start gap-2">
                    <span className="text-sm">{result.isCorrect ? 'Y' : 'X'}</span>
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-gray-900 text-xs mb-1 line-clamp-2">
                        {question?.question}
                      </p>
                      <p className="text-xs text-gray-600">
                        <strong>You:</strong> {result.userAnswer}
                      </p>
                      {!result.isCorrect && (
                        <p className="text-xs text-green-700 mt-1">
                          <strong>Correct:</strong> {result.correctAnswer}
                        </p>
                      )}
                      <p className="text-xs text-gray-500 mt-1 italic line-clamp-2">
                        {result.explanation}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={generateQuestions}
              className="flex-1 py-2 text-sm font-medium text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50"
            >
              Try Again
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

  return null;
}
