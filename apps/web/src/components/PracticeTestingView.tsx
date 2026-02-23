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
  onComplete: () => void;
  onBack: () => void;
}

// ─── Component ─────────────────────────────────────────────

export function PracticeTestingView({
  selectedText,
  courseId,
  contentId,
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

  // ─── Render Based on State ───────────────────────────────

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
        <p className="text-gray-600">
          {questions.length === 0
            ? 'Generating questions from your selected text...'
            : 'Submitting your answers...'}
        </p>
      </div>
    );
  }

  if (state === 'error') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="text-red-500 text-5xl mb-4">⚠️</div>
        <p className="text-gray-700 mb-4">{error}</p>
        <div className="flex gap-3">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm font-medium text-gray-700 hover:text-gray-900"
          >
            Go Back
          </button>
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
      <div className="space-y-6">
        {/* Progress Bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{
                width: `${((currentQuestionIndex + 1) / questions.length) * 100}%`,
              }}
            />
          </div>
          <span className="text-sm text-gray-500 whitespace-nowrap">
            Question {currentQuestionIndex + 1} of {questions.length}
          </span>
        </div>

        {/* Question */}
        <div className="bg-white border border-gray-200 rounded-lg p-6">
          <p className="text-lg text-gray-900 mb-6">{question.question}</p>

          {question.type === 'mcq' && question.options ? (
            <div className="space-y-3">
              {question.options.map((option, idx) => {
                const letter = option.charAt(0);
                const isSelected = currentAnswer === letter;

                return (
                  <button
                    key={idx}
                    onClick={() => setCurrentAnswer(letter)}
                    className={`w-full text-left p-4 rounded-lg border-2 transition-all ${
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
              className="w-full p-4 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={4}
            />
          )}
        </div>

        {/* Actions */}
        <div className="flex justify-between">
          <button
            onClick={onBack}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-800"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmitAnswer}
            disabled={!currentAnswer.trim()}
            className={`px-6 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
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
      <div className="space-y-6">
        {/* Progress Bar */}
        <div className="flex items-center gap-3">
          <div className="flex-1 h-2 bg-gray-200 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-600 transition-all duration-300"
              style={{
                width: `${((currentQuestionIndex + 1) / questions.length) * 100}%`,
              }}
            />
          </div>
          <span className="text-sm text-gray-500 whitespace-nowrap">
            Question {currentQuestionIndex + 1} of {questions.length}
          </span>
        </div>

        {/* Answer Recorded */}
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-6">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-2xl">✅</span>
            <span className="font-medium text-blue-800">Answer Recorded</span>
          </div>
          <p className="text-gray-700 mb-2">
            <strong>Question:</strong> {question?.question}
          </p>
          <p className="text-gray-700">
            <strong>Your Answer:</strong> {userAnswer}
          </p>
          <p className="text-sm text-gray-500 mt-4">
            You'll see detailed feedback after completing all questions.
          </p>
        </div>

        {/* Actions */}
        <div className="flex justify-end">
          <button
            onClick={handleContinueAfterReview}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            {currentQuestionIndex === questions.length - 1 ? 'See Results' : 'Next Question'}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'complete' && finalResults) {
    const { score, totalQuestions, percentage, results } = finalResults;

    // Determine score emoji/color
    let scoreEmoji = '🎉';
    let scoreColor = 'text-green-600';
    if (percentage < 50) {
      scoreEmoji = '📚';
      scoreColor = 'text-orange-600';
    } else if (percentage < 80) {
      scoreEmoji = '👍';
      scoreColor = 'text-blue-600';
    }

    return (
      <div className="space-y-6">
        {/* Score Summary */}
        <div className="bg-gradient-to-r from-blue-50 to-indigo-50 rounded-xl p-8 text-center">
          <div className="text-5xl mb-4">{scoreEmoji}</div>
          <h3 className={`text-3xl font-bold ${scoreColor} mb-2`}>
            {score}/{totalQuestions}
          </h3>
          <p className="text-gray-600">
            You scored <strong>{percentage}%</strong>
          </p>

          {/* Progress Ring */}
          <div className="mt-6 flex justify-center">
            <div className="relative w-24 h-24">
              <svg className="w-full h-full transform -rotate-90">
                <circle cx="48" cy="48" r="40" stroke="#e5e7eb" strokeWidth="8" fill="none" />
                <circle
                  cx="48"
                  cy="48"
                  r="40"
                  stroke={percentage >= 80 ? '#22c55e' : percentage >= 50 ? '#3b82f6' : '#f97316'}
                  strokeWidth="8"
                  fill="none"
                  strokeDasharray={`${(percentage / 100) * 251.2} 251.2`}
                  className="transition-all duration-500"
                />
              </svg>
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="text-xl font-bold text-gray-700">{percentage}%</span>
              </div>
            </div>
          </div>
        </div>

        {/* Detailed Results */}
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900">Question Review</h4>
          {results.map((result, idx) => {
            const question = questions[result.questionIndex];
            return (
              <div
                key={idx}
                className={`border rounded-lg p-4 ${
                  result.isCorrect ? 'border-green-200 bg-green-50' : 'border-red-200 bg-red-50'
                }`}
              >
                <div className="flex items-start gap-3">
                  <span className="text-xl">{result.isCorrect ? '✅' : '❌'}</span>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 mb-2">{question?.question}</p>
                    <p className="text-sm text-gray-600">
                      <strong>Your answer:</strong> {result.userAnswer}
                    </p>
                    {!result.isCorrect && (
                      <p className="text-sm text-green-700 mt-1">
                        <strong>Correct answer:</strong> {result.correctAnswer}
                      </p>
                    )}
                    <p className="text-sm text-gray-500 mt-2 italic">{result.explanation}</p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Actions */}
        <div className="flex justify-between pt-4">
          <button
            onClick={generateQuestions}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Try Again
          </button>
          <button
            onClick={onComplete}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Done
          </button>
        </div>
      </div>
    );
  }

  return null;
}
