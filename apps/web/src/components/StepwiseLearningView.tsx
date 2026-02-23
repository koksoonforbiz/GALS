import { useState, useEffect } from 'react';
import { api } from '../lib/api';

// ─── Types ─────────────────────────────────────────────────

interface ComprehensionCheck {
  question: string;
  hint: string;
  sampleAnswer: string;
}

interface LearningStep {
  stepNumber: number;
  title: string;
  content: string;
  comprehensionCheck: ComprehensionCheck;
}

interface UserStepResponse {
  stepNumber: number;
  response: string;
  feedback: string;
  isCorrect: boolean;
  submittedAt: string;
}

interface GenerateResponse {
  interventionId: string;
  sessionId: string;
  steps: LearningStep[];
  summary: string;
  totalSteps: number;
  currentStep: number;
}

interface StepCheckResult {
  isCorrect: boolean;
  feedback: string;
  encouragement: string;
}

interface StepwiseSessionResult {
  sessionId: string;
  interventionId: string;
  steps: LearningStep[];
  summary: string;
  totalSteps: number;
  currentStep: number;
  userResponses: UserStepResponse[];
  completed: boolean;
  sourceText: string;
}

interface StepwiseSummary {
  sessionId: string;
  totalSteps: number;
  correctOnFirstTry: number;
  completed: boolean;
  summary: string;
  userResponses: UserStepResponse[];
}

type ViewState = 'loading' | 'stepping' | 'checking' | 'feedback' | 'complete' | 'error';

interface StepwiseLearningViewProps {
  selectedText: string;
  courseId: string;
  contentId: string;
  pageType?: string; // "lesson", "quiz", "reading", etc.
  onComplete: () => void;
  onBack: () => void;
}

// ─── Component ─────────────────────────────────────────────

export function StepwiseLearningView({
  selectedText,
  courseId,
  contentId,
  pageType,
  onComplete,
  onBack,
}: StepwiseLearningViewProps) {
  const [state, setState] = useState<ViewState>('loading');
  const [error, setError] = useState<string | null>(null);

  // Session data
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [steps, setSteps] = useState<LearningStep[]>([]);
  const [_summary, setSummary] = useState('');
  void _summary; // Used for resume functionality
  const [currentStep, setCurrentStep] = useState(0);
  const [userResponses, setUserResponses] = useState<Map<number, UserStepResponse>>(new Map());

  // Current step input
  const [currentResponse, setCurrentResponse] = useState('');

  // Feedback state
  const [currentFeedback, setCurrentFeedback] = useState<StepCheckResult | null>(null);
  const [showHint, setShowHint] = useState(false);

  // Completion summary
  const [completionSummary, setCompletionSummary] = useState<StepwiseSummary | null>(null);

  // ─── Generate Steps on Mount ─────────────────────────────
  useEffect(() => {
    generateSteps();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const generateSteps = async () => {
    setState('loading');
    setError(null);

    try {
      const response = await api.post<GenerateResponse>(
        '/learning-interventions/stepwise-learning/generate',
        {
          selectedText,
          courseId,
          contentId,
          pageType,
        },
      );

      setSessionId(response.sessionId);
      setSteps(response.steps);
      setSummary(response.summary);
      setCurrentStep(response.currentStep);
      setUserResponses(new Map());
      setCurrentResponse('');
      setCurrentFeedback(null);
      setShowHint(false);
      setState('stepping');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate steps');
      setState('error');
    }
  };

  // ─── Submit Comprehension Check ──────────────────────────
  const handleSubmitCheck = async () => {
    if (!sessionId || currentResponse.length < 10) return;

    const step = steps[currentStep];
    if (!step) return;

    setState('checking');

    try {
      const response = await api.post<StepCheckResult>(
        `/learning-interventions/stepwise-learning/${sessionId}/check`,
        {
          stepNumber: step.stepNumber,
          userResponse: currentResponse,
        },
      );

      // Store the response
      const newEntry: UserStepResponse = {
        stepNumber: step.stepNumber,
        response: currentResponse,
        feedback: response.feedback,
        isCorrect: response.isCorrect,
        submittedAt: new Date().toISOString(),
      };

      const newResponses = new Map(userResponses);
      newResponses.set(step.stepNumber, newEntry);
      setUserResponses(newResponses);

      setCurrentFeedback(response);
      setShowHint(false);
      setState('feedback');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to check response');
      setState('error');
    }
  };

  // ─── Handle Try Again ────────────────────────────────────
  const handleTryAgain = () => {
    setCurrentResponse('');
    setCurrentFeedback(null);
    setShowHint(true); // Show hint on retry
    setState('stepping');
  };

  // ─── Advance to Next Step ────────────────────────────────
  const handleNextStep = async () => {
    if (!sessionId) return;

    if (currentStep >= steps.length - 1) {
      // Last step - complete the session
      await handleComplete();
      return;
    }

    setState('loading');

    try {
      const response = await api.patch<StepwiseSessionResult>(
        `/learning-interventions/stepwise-learning/${sessionId}/advance`,
        {},
      );

      setCurrentStep(response.currentStep);
      setCurrentResponse('');
      setCurrentFeedback(null);
      setShowHint(false);

      if (response.completed) {
        await handleComplete();
      } else {
        setState('stepping');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to advance step');
      setState('error');
    }
  };

  // ─── Complete Session ────────────────────────────────────
  const handleComplete = async () => {
    if (!sessionId) return;

    setState('loading');

    try {
      const response = await api.post<StepwiseSummary>(
        `/learning-interventions/stepwise-learning/${sessionId}/complete`,
      );

      setCompletionSummary(response);
      setState('complete');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to complete session');
      setState('error');
    }
  };

  // ─── Back to Chat Header ─────────────────────────────────
  const BackHeader = () => (
    <div className="flex items-center gap-2 pb-3 mb-4 border-b border-gray-200">
      <button
        onClick={onBack}
        className="text-sm text-gray-500 hover:text-gray-700 flex items-center gap-1"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
        </svg>
        Back to chat
      </button>
      <span className="text-sm font-medium text-gray-700">Stepwise Learning</span>
    </div>
  );

  // ─── Render Based on State ───────────────────────────────

  if (state === 'loading') {
    return (
      <div className="w-full">
        <BackHeader />
        <div className="flex flex-col items-center justify-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4" />
          <p className="text-gray-600 text-sm text-center">
            {steps.length === 0 ? 'Breaking down content into learning steps...' : 'Processing...'}
          </p>
        </div>
      </div>
    );
  }

  if (state === 'checking') {
    return (
      <div className="w-full">
        <BackHeader />
        <div className="flex flex-col items-center justify-center py-8">
          <div className="animate-spin rounded-full h-10 w-10 border-b-2 border-blue-600 mb-4" />
          <p className="text-gray-600 text-sm text-center">Checking your response...</p>
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
            onClick={generateSteps}
            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700"
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  if (state === 'stepping' || state === 'feedback') {
    const step = steps[currentStep];
    if (!step) return null;

    const isValid = currentResponse.length >= 10;
    const existingResponse = userResponses.get(step.stepNumber);

    return (
      <div className="w-full">
        <BackHeader />
        <div className="space-y-4">
          {/* Stepper Progress */}
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-1">
              {steps.map((s, idx) => {
                const response = userResponses.get(s.stepNumber);
                const isCompleted = response?.isCorrect;
                const isCurrent = idx === currentStep;

                return (
                  <div key={s.stepNumber} className="flex items-center">
                    {/* Step Circle */}
                    <div
                      className={`w-6 h-6 rounded-full flex items-center justify-center text-xs font-medium transition-colors ${
                        isCompleted
                          ? 'bg-green-500 text-white'
                          : isCurrent
                            ? 'bg-blue-600 text-white'
                            : 'bg-gray-200 text-gray-500'
                      }`}
                    >
                      {isCompleted ? 'Y' : s.stepNumber}
                    </div>
                    {/* Connector Line */}
                    {idx < steps.length - 1 && (
                      <div
                        className={`w-3 h-0.5 ${isCompleted ? 'bg-green-500' : 'bg-gray-200'}`}
                      />
                    )}
                  </div>
                );
              })}
            </div>
            <span className="text-xs text-gray-500">
              {currentStep + 1}/{steps.length}
            </span>
          </div>

          {/* Current Step Card */}
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            {/* Step Header */}
            <div className="bg-gradient-to-r from-blue-50 to-indigo-50 px-4 py-3 border-b border-gray-100">
              <h3 className="text-sm font-semibold text-gray-900">{step.title}</h3>
            </div>

            {/* Step Content */}
            <div className="px-4 py-3">
              <p className="text-xs text-gray-700 leading-relaxed">{step.content}</p>
            </div>

            {/* Divider */}
            <div className="border-t border-gray-200 mx-4" />

            {/* Comprehension Check */}
            <div className="px-4 py-3">
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">
                Check Understanding
              </h4>
              <p className="text-sm text-gray-800 mb-3">{step.comprehensionCheck.question}</p>

              {state === 'feedback' && currentFeedback ? (
                // Show feedback
                <div className="space-y-3">
                  {/* Your Response */}
                  <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                    <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                      Your Response:
                    </p>
                    <p className="text-xs text-gray-700">{currentResponse}</p>
                  </div>

                  {/* Feedback Card */}
                  <div
                    className={`rounded-lg p-3 border ${
                      currentFeedback.isCorrect
                        ? 'bg-green-50 border-green-200'
                        : 'bg-orange-50 border-orange-200'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <span className="text-lg">{currentFeedback.isCorrect ? 'Y' : '-'}</span>
                      <div className="flex-1">
                        <p className="text-xs text-gray-700 mb-1">{currentFeedback.feedback}</p>
                        <p className="text-xs text-gray-500 italic">
                          {currentFeedback.encouragement}
                        </p>
                      </div>
                    </div>

                    {/* Hint (shown if incorrect) */}
                    {!currentFeedback.isCorrect && (
                      <div className="mt-3 pt-3 border-t border-orange-200">
                        <p className="text-xs text-orange-700">
                          <strong>Hint:</strong> {step.comprehensionCheck.hint}
                        </p>
                      </div>
                    )}
                  </div>

                  {/* Actions */}
                  <div className="flex gap-2">
                    {!currentFeedback.isCorrect && (
                      <button
                        onClick={handleTryAgain}
                        className="flex-1 py-2 text-sm font-medium text-orange-600 border border-orange-200 rounded-lg hover:bg-orange-50"
                      >
                        Try Again
                      </button>
                    )}
                    <button
                      onClick={handleNextStep}
                      className={`py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 ${
                        !currentFeedback.isCorrect ? 'flex-1' : 'w-full'
                      }`}
                    >
                      {currentStep === steps.length - 1 ? 'Complete' : 'Next'}
                    </button>
                  </div>
                </div>
              ) : (
                // Show input
                <div className="space-y-3">
                  {/* Show hint if retrying */}
                  {showHint && (
                    <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                      <p className="text-xs text-blue-700">
                        <strong>Hint:</strong> {step.comprehensionCheck.hint}
                      </p>
                    </div>
                  )}

                  {/* Previous attempt (if retrying) */}
                  {existingResponse && !existingResponse.isCorrect && (
                    <div className="bg-gray-50 border border-gray-200 rounded-lg p-3">
                      <p className="text-xs text-gray-500 uppercase tracking-wide mb-1">
                        Previous Attempt:
                      </p>
                      <p className="text-xs text-gray-600">{existingResponse.response}</p>
                    </div>
                  )}

                  {/* Textarea */}
                  <div className="relative">
                    <textarea
                      value={currentResponse}
                      onChange={(e) => setCurrentResponse(e.target.value)}
                      placeholder="Type your answer... (min 10 chars)"
                      className="w-full p-3 border border-gray-200 rounded-lg resize-none focus:outline-none focus:ring-2 focus:ring-blue-500 text-sm"
                      rows={3}
                    />
                    <div className="flex justify-between items-center mt-2">
                      <span className={`text-xs ${isValid ? 'text-green-600' : 'text-gray-400'}`}>
                        {currentResponse.length}/10 {isValid && 'Y'}
                      </span>
                    </div>
                  </div>

                  {/* Actions */}
                  <button
                    onClick={handleSubmitCheck}
                    disabled={!isValid}
                    className={`w-full py-2 text-sm font-medium text-white rounded-lg transition-colors ${
                      isValid ? 'bg-blue-600 hover:bg-blue-700' : 'bg-gray-300 cursor-not-allowed'
                    }`}
                  >
                    Check
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (state === 'complete' && completionSummary) {
    const {
      totalSteps,
      correctOnFirstTry,
      summary: completionMessage,
      userResponses: responses,
    } = completionSummary;

    return (
      <div className="w-full">
        <BackHeader />
        <div className="space-y-4">
          {/* Summary Header */}
          <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 text-center">
            <h3 className="text-lg font-bold text-gray-900 mb-1">Learning Complete!</h3>
            <p className="text-gray-600 text-sm mb-3">{completionMessage}</p>

            {/* Stats */}
            <div className="flex justify-center gap-6">
              <div className="text-center">
                <div className="text-2xl font-bold text-green-600">{totalSteps}</div>
                <div className="text-xs text-gray-500">Steps</div>
              </div>
              <div className="text-center">
                <div className="text-2xl font-bold text-blue-600">{correctOnFirstTry}</div>
                <div className="text-xs text-gray-500">First Try</div>
              </div>
            </div>
          </div>

          {/* Learning Journey Timeline (scrollable) */}
          <div className="space-y-3 max-h-60 overflow-y-auto">
            <h4 className="font-medium text-gray-900 text-sm sticky top-0 bg-white">
              Your Journey
            </h4>
            <div className="relative">
              {/* Timeline Line */}
              <div className="absolute left-3 top-0 bottom-0 w-0.5 bg-gray-200" />

              {/* Steps */}
              {steps.map((step) => {
                const response = responses.find((r) => r.stepNumber === step.stepNumber);
                const isCorrectFirstTry = response?.isCorrect;

                return (
                  <div key={step.stepNumber} className="relative pl-8 pb-3">
                    {/* Timeline Dot */}
                    <div
                      className={`absolute left-1.5 w-4 h-4 rounded-full border-2 ${
                        isCorrectFirstTry
                          ? 'bg-green-500 border-green-500'
                          : 'bg-yellow-400 border-yellow-400'
                      }`}
                    >
                      <span className="absolute inset-0 flex items-center justify-center text-white text-xs">
                        {isCorrectFirstTry ? 'Y' : 'R'}
                      </span>
                    </div>

                    {/* Step Content */}
                    <div
                      className={`p-3 rounded-lg border ${
                        isCorrectFirstTry
                          ? 'bg-green-50 border-green-200'
                          : 'bg-yellow-50 border-yellow-200'
                      }`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <span className="text-xs font-medium text-gray-900 line-clamp-1">
                          {step.stepNumber}. {step.title}
                        </span>
                        <span
                          className={`text-xs px-1.5 py-0.5 rounded-full ${
                            isCorrectFirstTry
                              ? 'bg-green-100 text-green-700'
                              : 'bg-yellow-100 text-yellow-700'
                          }`}
                        >
                          {isCorrectFirstTry ? '1st' : 'Retry'}
                        </span>
                      </div>
                      {response && (
                        <p className="text-xs text-gray-600 line-clamp-2">{response.feedback}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* Actions */}
          <div className="flex gap-2 pt-2">
            <button
              onClick={generateSteps}
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
