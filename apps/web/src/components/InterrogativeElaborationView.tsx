import { useState, useEffect } from 'react';
import { api } from '../lib/api';

// ─── Types ─────────────────────────────────────────────────

interface ElaborationQuestion {
  question: string;
  type: 'why' | 'how';
  keyPoints: string[];
}

interface UserElaborationEntry {
  questionIndex: number;
  elaboration: string;
  rating: 'Strong' | 'Developing' | 'Needs Improvement';
  feedback: string;
  addressedPoints: string[];
  missedPoints: string[];
  modelElaboration: string;
  submittedAt: string;
}

interface GenerateResponse {
  interventionId: string;
  sessionId: string;
  questions: ElaborationQuestion[];
  sourceText: string;
}

interface EvaluationResponse {
  questionIndex: number;
  rating: 'Strong' | 'Developing' | 'Needs Improvement';
  addressedPoints: string[];
  missedPoints: string[];
  feedback: string;
  modelElaboration: string;
}

interface ElaborationSummary {
  sessionId: string;
  totalQuestions: number;
  completed: boolean;
  ratings: {
    strong: number;
    developing: number;
    needsImprovement: number;
  };
  overallMessage: string;
  elaborations: UserElaborationEntry[];
}

type ViewState = 'loading' | 'answering' | 'evaluating' | 'feedback' | 'complete' | 'error';

interface InterrogativeElaborationViewProps {
  selectedText: string;
  courseId: string;
  contentId: string;
  onComplete: () => void;
  onBack: () => void;
}

// ─── Component ─────────────────────────────────────────────

export function InterrogativeElaborationView({
  selectedText,
  courseId,
  contentId,
  onComplete,
  onBack,
}: InterrogativeElaborationViewProps) {
  const [state, setState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);

  // Session data
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [questions, setQuestions] = useState<ElaborationQuestion[]>([]);
  const [currentQuestionIndex, setCurrentQuestionIndex] = useState(0);

  // Current elaboration
  const [currentElaboration, setCurrentElaboration] = useState('');

  // Evaluation feedback
  const [currentFeedback, setCurrentFeedback] = useState<EvaluationResponse | null>(null);
  const [previousAttempt, setPreviousAttempt] = useState<string | null>(null);

  // All elaborations (for tracking and summary)
  const [elaborations, setElaborations] = useState<Map<number, UserElaborationEntry>>(new Map());

  // Summary data
  const [summary, setSummary] = useState<ElaborationSummary | null>(null);

  // Show model answer toggle
  const [showModelAnswer, setShowModelAnswer] = useState(false);

  // ─── Generate Questions on Mount ─────────────────────────
  useEffect(() => {
    generateQuestions();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const generateQuestions = async () => {
    setState('loading');
    setError(null);

    try {
      const response = await api.post<GenerateResponse>(
        '/learning-interventions/interrogative-elaboration/generate',
        {
          selectedText,
          courseId,
          contentId,
          questionCount: 4,
        },
      );

      setSessionId(response.sessionId);
      setQuestions(response.questions);
      setCurrentQuestionIndex(0);
      setCurrentElaboration('');
      setElaborations(new Map());
      setState('answering');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate questions');
      setState('error');
    }
  };

  // ─── Submit Elaboration for Evaluation ───────────────────
  const handleSubmitElaboration = async () => {
    if (!sessionId || currentElaboration.length < 50) return;

    setState('evaluating');

    try {
      const response = await api.post<EvaluationResponse>(
        `/learning-interventions/interrogative-elaboration/${sessionId}/evaluate`,
        {
          questionIndex: currentQuestionIndex,
          elaboration: currentElaboration,
        },
      );

      // Store the evaluation result
      const entry: UserElaborationEntry = {
        questionIndex: currentQuestionIndex,
        elaboration: currentElaboration,
        rating: response.rating,
        feedback: response.feedback,
        addressedPoints: response.addressedPoints,
        missedPoints: response.missedPoints,
        modelElaboration: response.modelElaboration,
        submittedAt: new Date().toISOString(),
      };

      const newElaborations = new Map(elaborations);
      newElaborations.set(currentQuestionIndex, entry);
      setElaborations(newElaborations);

      setCurrentFeedback(response);
      setShowModelAnswer(false);
      setState('feedback');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to evaluate elaboration');
      setState('error');
    }
  };

  // ─── Handle Revision ─────────────────────────────────────
  const handleRevise = () => {
    setPreviousAttempt(currentElaboration);
    setCurrentElaboration('');
    setCurrentFeedback(null);
    setState('answering');
  };

  // ─── Move to Next Question ───────────────────────────────
  const handleNextQuestion = () => {
    if (currentQuestionIndex < questions.length - 1) {
      setCurrentQuestionIndex((prev) => prev + 1);
      setCurrentElaboration('');
      setCurrentFeedback(null);
      setPreviousAttempt(null);
      setShowModelAnswer(false);
      setState('answering');
    } else {
      // Last question - complete the session
      handleComplete();
    }
  };

  // ─── Complete Session ────────────────────────────────────
  const handleComplete = async () => {
    if (!sessionId) return;

    setState('loading');

    try {
      const response = await api.post<ElaborationSummary>(
        `/learning-interventions/interrogative-elaboration/${sessionId}/complete`,
      );

      setSummary(response);
      setState('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete session');
      setState('error');
    }
  };

  // ─── Render Based on State ───────────────────────────────

  if (state === 'loading') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
        <p className="text-gray-600">
          {questions.length === 0
            ? 'Generating elaboration questions...'
            : 'Processing...'}
        </p>
      </div>
    );
  }

  if (state === 'evaluating') {
    return (
      <div className="flex flex-col items-center justify-center py-12">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mb-4" />
        <p className="text-gray-600">Evaluating your response...</p>
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

  if (state === 'answering') {
    const question = questions[currentQuestionIndex];
    if (!question) return null;

    const charCount = currentElaboration.length;
    const isValid = charCount >= 50;

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
          {/* Question Type Badge */}
          <div className="mb-3">
            <span
              className={`inline-block px-3 py-1 text-xs font-semibold rounded-full uppercase ${
                question.type === 'why'
                  ? 'bg-blue-100 text-blue-700'
                  : 'bg-green-100 text-green-700'
              }`}
            >
              {question.type}
            </span>
          </div>

          {/* Question Text */}
          <p className="text-lg text-gray-900 mb-6">{question.question}</p>

          {/* Previous Attempt (if revising) */}
          {previousAttempt && (
            <div className="mb-4 p-4 bg-gray-50 border border-gray-200 rounded-lg">
              <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
                Your Previous Attempt:
              </p>
              <p className="text-sm text-gray-600">{previousAttempt}</p>
            </div>
          )}

          {/* Elaboration Textarea */}
          <div className="relative">
            <textarea
              value={currentElaboration}
              onChange={(e) => setCurrentElaboration(e.target.value)}
              placeholder="Explain your reasoning in detail... (minimum 50 characters)"
              className="w-full p-4 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              rows={6}
            />
            <div className="flex justify-between items-center mt-2">
              <span
                className={`text-xs ${
                  isValid ? 'text-green-600' : 'text-gray-400'
                }`}
              >
                {charCount}/50 characters {isValid && '✓'}
              </span>
            </div>
          </div>
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
            onClick={handleSubmitElaboration}
            disabled={!isValid}
            className={`px-6 py-2 text-sm font-medium text-white rounded-lg transition-colors ${
              isValid
                ? 'bg-blue-600 hover:bg-blue-700'
                : 'bg-gray-300 cursor-not-allowed'
            }`}
          >
            Submit Elaboration
          </button>
        </div>
      </div>
    );
  }

  if (state === 'feedback' && currentFeedback) {
    const question = questions[currentQuestionIndex];
    if (!question) return null;

    // Rating colors
    const ratingConfig = {
      Strong: { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' },
      Developing: { bg: 'bg-yellow-100', text: 'text-yellow-700', border: 'border-yellow-200' },
      'Needs Improvement': { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' },
    };

    const config = ratingConfig[currentFeedback.rating];

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

        {/* Question Reminder */}
        <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
          <span
            className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full uppercase mb-2 ${
              question.type === 'why'
                ? 'bg-blue-100 text-blue-700'
                : 'bg-green-100 text-green-700'
            }`}
          >
            {question.type}
          </span>
          <p className="text-gray-700">{question.question}</p>
        </div>

        {/* Rating Badge */}
        <div className={`rounded-lg p-6 border ${config.border} ${config.bg}`}>
          <div className="flex items-center gap-3 mb-4">
            <span className={`text-2xl font-bold ${config.text}`}>
              {currentFeedback.rating === 'Strong' && '🎯'}
              {currentFeedback.rating === 'Developing' && '📈'}
              {currentFeedback.rating === 'Needs Improvement' && '📚'}
            </span>
            <span className={`text-lg font-semibold ${config.text}`}>
              {currentFeedback.rating}
            </span>
          </div>

          {/* What you covered well */}
          {currentFeedback.addressedPoints.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                What you covered well:
              </p>
              <ul className="space-y-1">
                {currentFeedback.addressedPoints.map((point, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-green-500 mt-0.5">✓</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Points to consider */}
          {currentFeedback.missedPoints.length > 0 && (
            <div className="mb-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                Points to consider:
              </p>
              <ul className="space-y-1">
                {currentFeedback.missedPoints.map((point, idx) => (
                  <li key={idx} className="flex items-start gap-2 text-sm text-gray-600">
                    <span className="text-blue-500 mt-0.5">→</span>
                    {point}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Feedback */}
          <div className="mb-4">
            <p className="text-sm font-medium text-gray-700 mb-2">Feedback:</p>
            <p className="text-sm text-gray-600 italic">{currentFeedback.feedback}</p>
          </div>

          {/* Model Answer (expandable) */}
          <div>
            <button
              onClick={() => setShowModelAnswer(!showModelAnswer)}
              className="text-sm text-blue-600 hover:text-blue-800 font-medium flex items-center gap-1"
            >
              {showModelAnswer ? '▼' : '▶'} See model answer
            </button>
            {showModelAnswer && (
              <div className="mt-3 p-4 bg-white border border-gray-200 rounded-lg">
                <p className="text-sm text-gray-700">{currentFeedback.modelElaboration}</p>
              </div>
            )}
          </div>
        </div>

        {/* Your Elaboration */}
        <div className="bg-white border border-gray-200 rounded-lg p-4">
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
            Your Elaboration:
          </p>
          <p className="text-sm text-gray-700">{currentElaboration}</p>
        </div>

        {/* Actions */}
        <div className="flex justify-between">
          <button
            onClick={handleRevise}
            className="px-4 py-2 text-sm font-medium text-blue-600 hover:text-blue-800"
          >
            Revise & Resubmit
          </button>
          <button
            onClick={handleNextQuestion}
            className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            {currentQuestionIndex === questions.length - 1 ? 'See Results' : 'Next Question'}
          </button>
        </div>
      </div>
    );
  }

  if (state === 'complete' && summary) {
    const { ratings, overallMessage, elaborations: summaryElaborations } = summary;

    return (
      <div className="space-y-6">
        {/* Summary Header */}
        <div className="bg-gradient-to-r from-indigo-50 to-purple-50 rounded-xl p-8 text-center">
          <div className="text-5xl mb-4">🧠</div>
          <h3 className="text-2xl font-bold text-gray-900 mb-2">
            Elaboration Quality Summary
          </h3>
          <p className="text-gray-600 mb-6">{overallMessage}</p>

          {/* Rating Breakdown */}
          <div className="flex justify-center gap-6">
            <div className="text-center">
              <div className="text-2xl font-bold text-green-600">{ratings.strong}</div>
              <div className="text-xs text-gray-500 uppercase">Strong</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-yellow-600">{ratings.developing}</div>
              <div className="text-xs text-gray-500 uppercase">Developing</div>
            </div>
            <div className="text-center">
              <div className="text-2xl font-bold text-red-600">{ratings.needsImprovement}</div>
              <div className="text-xs text-gray-500 uppercase">Needs Work</div>
            </div>
          </div>
        </div>

        {/* Question Review */}
        <div className="space-y-4">
          <h4 className="font-medium text-gray-900">Your Elaborations</h4>
          {summaryElaborations.map((elab, idx) => {
            const question = questions[elab.questionIndex];
            const ratingConfig = {
              Strong: { bg: 'bg-green-50', border: 'border-green-200', badge: 'bg-green-100 text-green-700' },
              Developing: { bg: 'bg-yellow-50', border: 'border-yellow-200', badge: 'bg-yellow-100 text-yellow-700' },
              'Needs Improvement': { bg: 'bg-red-50', border: 'border-red-200', badge: 'bg-red-100 text-red-700' },
            };
            const config = ratingConfig[elab.rating];

            return (
              <div
                key={idx}
                className={`border rounded-lg p-4 ${config.border} ${config.bg}`}
              >
                <div className="flex items-start gap-3">
                  <span
                    className={`inline-block px-2 py-0.5 text-xs font-semibold rounded-full ${config.badge}`}
                  >
                    {elab.rating}
                  </span>
                  <div className="flex-1">
                    <p className="font-medium text-gray-900 mb-2">
                      {question?.question}
                    </p>
                    <p className="text-sm text-gray-600 mb-2">{elab.elaboration}</p>
                    <p className="text-xs text-gray-500 italic">{elab.feedback}</p>
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
