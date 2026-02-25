import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../lib/api';
import type { SaveForReviewInput } from '../types';

interface StepwiseLearningViewProps {
  selectedText: string;
  courseId: string;
  contentId: string | null;
  pageType: string;
  contentTitle: string;
  resumeSessionId?: string | null;
  onComplete: () => void;
  onBack: () => void;
  onSaveForReview: (data: SaveForReviewInput) => void;
  onSessionCreated?: (sessionId: string) => void;
}

interface ComprehensionCheck {
  question: string;
  hint: string;
  sampleAnswer: string;
}

interface StepwiseStep {
  stepNumber: number;
  title: string;
  content: string;
  comprehensionCheck: ComprehensionCheck;
}

interface StepResult {
  attempts: number;
  passed: boolean;
  userResponses: Array<{
    response: string;
    feedback: string;
    isCorrect: boolean;
    timestamp: string;
  }>;
}

interface CheckResponse {
  isCorrect: boolean;
  feedback: string;
  encouragement: string;
  attempts: number;
  showAnswer: boolean;
  sampleAnswer?: string;
}

type Phase = 'loading' | 'step' | 'feedback' | 'completing' | 'complete' | 'error';

const STORAGE_KEY = 'stepwise_session_';

export function StepwiseLearningView({
  selectedText,
  courseId,
  contentId,
  pageType,
  contentTitle,
  resumeSessionId,
  onComplete,
  onBack,
  onSaveForReview,
  onSessionCreated,
}: StepwiseLearningViewProps) {
  const [phase, setPhase] = useState<Phase>('loading');
  const [interventionId, setInterventionId] = useState<string | null>(resumeSessionId || null);
  const [steps, setSteps] = useState<StepwiseStep[]>([]);
  const [summary, setSummary] = useState('');
  const [currentStep, setCurrentStep] = useState(1);
  const [totalSteps, setTotalSteps] = useState(0);
  const [stepResults, setStepResults] = useState<Record<number, StepResult>>({});
  const [inputValue, setInputValue] = useState('');
  const [isChecking, setIsChecking] = useState(false);
  const [lastCheck, setLastCheck] = useState<CheckResponse | null>(null);
  const [showHint, setShowHint] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [completionData, setCompletionData] = useState<{
    summary: string;
    totalSteps: number;
    stepsCompleted: number;
  } | null>(null);
  const initialGenDone = useRef(false);

  // Generate or resume on mount
  const generate = useCallback(async () => {
    setPhase('loading');
    try {
      const result = await api.post<{
        interventionId: string;
        steps: Array<{ stepNumber: number; title: string }>;
        totalSteps: number;
      }>('/learning-interventions/stepwise-learning/generate', {
        selectedText,
        courseId,
        contentId: contentId || undefined,
        pageType,
      });
      setInterventionId(result.interventionId);
      setTotalSteps(result.totalSteps);
      onSessionCreated?.(result.interventionId);

      // Store session ID for resume
      try {
        localStorage.setItem(
          STORAGE_KEY + courseId,
          JSON.stringify({ sessionId: result.interventionId, timestamp: Date.now() }),
        );
      } catch {
        // localStorage may be unavailable
      }

      // Fetch full session to get step content
      const session = await api.get<{
        steps: StepwiseStep[];
        summary: string;
        currentStep: number;
        stepResults: Record<number, StepResult>;
      }>(`/learning-interventions/stepwise-learning/${result.interventionId}`);

      setSteps(session.steps);
      setSummary(session.summary);
      setCurrentStep(session.currentStep);
      setStepResults(session.stepResults || {});
      setPhase('step');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate steps');
      setPhase('error');
    }
  }, [selectedText, courseId, contentId, pageType, onSessionCreated]);

  const resumeSession = useCallback(
    async (sessionId: string) => {
      setPhase('loading');
      try {
        const session = await api.get<{
          interventionId: string;
          status: string;
          steps: StepwiseStep[];
          summary: string;
          currentStep: number;
          totalSteps: number;
          stepResults: Record<number, StepResult>;
        }>(`/learning-interventions/stepwise-learning/${sessionId}`);

        setInterventionId(session.interventionId);
        setSteps(session.steps);
        setSummary(session.summary);
        setCurrentStep(session.currentStep);
        setTotalSteps(session.totalSteps);
        setStepResults(session.stepResults || {});

        if (session.status === 'COMPLETED') {
          const stepsCompleted = Object.values(session.stepResults || {}).filter(
            (r) => r.passed,
          ).length;
          setCompletionData({
            summary: session.summary,
            totalSteps: session.totalSteps,
            stepsCompleted,
          });
          setPhase('complete');
        } else {
          setPhase('step');
        }
      } catch {
        // If resume fails, start fresh
        initialGenDone.current = false;
        void generate();
      }
    },
    [generate],
  );

  useEffect(() => {
    if (initialGenDone.current) return;
    initialGenDone.current = true;

    if (resumeSessionId) {
      void resumeSession(resumeSessionId);
    } else {
      void generate();
    }
  }, [generate, resumeSession, resumeSessionId]);

  const currentStepData = steps.find((s) => s.stepNumber === currentStep);
  const currentResult = stepResults[currentStep];

  const handleSubmitCheck = async () => {
    if (!interventionId || !inputValue.trim() || inputValue.trim().length < 10) return;

    setIsChecking(true);
    setLastCheck(null);

    try {
      const result = await api.post<CheckResponse>(
        `/learning-interventions/stepwise-learning/${interventionId}/check`,
        {
          stepNumber: currentStep,
          userResponse: inputValue.trim(),
        },
      );

      setLastCheck(result);
      setPhase('feedback');

      // Update local step results
      if (result.isCorrect || result.showAnswer) {
        setStepResults((prev) => ({
          ...prev,
          [currentStep]: {
            attempts: result.attempts,
            passed: true,
            userResponses: [
              ...(prev[currentStep]?.userResponses || []),
              {
                response: inputValue.trim(),
                feedback: result.feedback,
                isCorrect: result.isCorrect,
                timestamp: new Date().toISOString(),
              },
            ],
          },
        }));
      } else {
        setStepResults((prev) => ({
          ...prev,
          [currentStep]: {
            attempts: result.attempts,
            passed: false,
            userResponses: [
              ...(prev[currentStep]?.userResponses || []),
              {
                response: inputValue.trim(),
                feedback: result.feedback,
                isCorrect: false,
                timestamp: new Date().toISOString(),
              },
            ],
          },
        }));
      }
    } catch {
      setLastCheck({
        isCorrect: false,
        feedback: 'Failed to check your answer. Please try again.',
        encouragement: 'Keep going!',
        attempts: (currentResult?.attempts || 0) + 1,
        showAnswer: false,
      });
      setPhase('feedback');
    } finally {
      setIsChecking(false);
    }
  };

  const handleNextStep = async () => {
    if (!interventionId) return;

    try {
      const result = await api.patch<{
        currentStep: number;
        totalSteps: number;
        completed: boolean;
      }>(`/learning-interventions/stepwise-learning/${interventionId}/advance`, {});

      if (result.completed) {
        handleWrapUp();
      } else {
        setCurrentStep(result.currentStep);
        setLastCheck(null);
        setInputValue('');
        setShowHint(false);
        setPhase('step');
      }
    } catch {
      // Fallback: just move locally
      const next = currentStep + 1;
      if (next > totalSteps) {
        handleWrapUp();
      } else {
        setCurrentStep(next);
        setLastCheck(null);
        setInputValue('');
        setShowHint(false);
        setPhase('step');
      }
    }
  };

  const handleRetryAnswer = () => {
    setInputValue('');
    setLastCheck(null);
    setPhase('step');
  };

  const handleWrapUp = async () => {
    if (!interventionId) return;
    setPhase('completing');

    try {
      const result = await api.post<{
        summary: string;
        totalSteps: number;
        stepsCompleted: number;
      }>(`/learning-interventions/stepwise-learning/${interventionId}/complete`);

      setCompletionData(result);
    } catch {
      const stepsCompleted = Object.values(stepResults).filter((r) => r.passed).length;
      setCompletionData({
        summary,
        totalSteps,
        stepsCompleted,
      });
    }

    // Clean up localStorage
    try {
      localStorage.removeItem(STORAGE_KEY + courseId);
    } catch {
      // ignore
    }

    setPhase('complete');
  };

  const handleSave = () => {
    if (!interventionId) return;

    onSaveForReview({
      interventionId,
      interventionType: 'STEPWISE_LEARNING',
      title: `Stepwise Learning - ${contentTitle || 'Untitled'}`,
      selectedText,
      savedData: {
        steps: steps.map((s) => ({
          stepNumber: s.stepNumber,
          title: s.title,
          content: s.content,
          question: s.comprehensionCheck.question,
          sampleAnswer: s.comprehensionCheck.sampleAnswer,
        })),
        stepResults,
        summary,
        totalSteps,
        stepsCompleted: Object.values(stepResults).filter((r) => r.passed).length,
        completedAt: new Date().toISOString(),
      },
    });
    setSaved(true);
  };

  const handleRetry = () => {
    setSteps([]);
    setSummary('');
    setCurrentStep(1);
    setTotalSteps(0);
    setStepResults({});
    setInputValue('');
    setLastCheck(null);
    setShowHint(false);
    setSaved(false);
    setCompletionData(null);
    setErrorMsg('');
    initialGenDone.current = false;
    void generate();
  };

  // ─── Loading Phase ──────────────────────────────────────
  if (phase === 'loading') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-2xl mb-3 animate-pulse">{'\uD83D\uDCDD'}</div>
        <p className="text-sm text-gray-600">
          {resumeSessionId
            ? 'Resuming your session...'
            : 'Breaking down the text into learning steps...'}
        </p>
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

  // ─── Completing Phase ───────────────────────────────────
  if (phase === 'completing') {
    return (
      <div className="flex-1 flex flex-col items-center justify-center p-6 text-center">
        <div className="text-2xl mb-3 animate-pulse">{'\uD83E\uDDE0'}</div>
        <p className="text-sm text-gray-600">Wrapping up...</p>
      </div>
    );
  }

  // ─── Complete Phase ─────────────────────────────────────
  if (phase === 'complete' && completionData) {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-3 border-b border-gray-100 bg-gray-50 text-center">
          <div className="text-lg mb-1">{'\uD83C\uDF89'}</div>
          <div className="text-sm font-semibold text-gray-800">Great work!</div>
          <div className="text-xs text-gray-600 mt-1">
            Completed {completionData.stepsCompleted} of {completionData.totalSteps} steps
          </div>
        </div>

        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Summary */}
          <div>
            <div className="text-xs font-medium text-gray-600 mb-1">Summary</div>
            <div className="text-xs text-gray-700 bg-blue-50 border border-blue-200 rounded p-2">
              {completionData.summary}
            </div>
          </div>

          {/* Step results overview */}
          <div>
            <div className="text-xs font-medium text-gray-600 mb-1">Steps overview</div>
            <div className="space-y-1">
              {steps.map((step) => {
                const result = stepResults[step.stepNumber];
                const passed = result?.passed;
                const attempts = result?.attempts || 0;
                return (
                  <div
                    key={step.stepNumber}
                    className="text-xs flex items-center gap-2 bg-gray-50 border border-gray-200 rounded p-2"
                  >
                    <span className={passed ? 'text-green-600' : 'text-gray-400'}>
                      {passed ? '\u2713' : '\u25CB'}
                    </span>
                    <span className="flex-1 text-gray-700">{step.title}</span>
                    {attempts > 0 && (
                      <span className="text-[10px] text-gray-400">
                        {attempts} {attempts === 1 ? 'attempt' : 'attempts'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
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

  // ─── Step & Feedback Phases ───────────────────────────────
  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      {/* Header with back + step counter */}
      <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
        <div className="flex items-center justify-between mb-1">
          <button onClick={onBack} className="text-xs text-blue-600 hover:text-blue-800">
            &larr; Back to chat
          </button>
          <span className="text-xs font-medium text-gray-600">Stepwise Learning</span>
        </div>
      </div>

      {/* Stepper dots */}
      <div className="px-3 py-2 border-b border-gray-100 bg-white">
        <div className="flex items-center justify-center gap-1.5">
          {steps.map((step) => {
            const result = stepResults[step.stepNumber];
            const isCurrent = step.stepNumber === currentStep;
            const isPassed = result?.passed;

            let dotClass =
              'w-6 h-6 rounded-full text-[10px] flex items-center justify-center font-medium transition-colors ';
            if (isPassed) {
              dotClass += 'bg-green-500 text-white';
            } else if (isCurrent) {
              dotClass += 'bg-blue-600 text-white';
            } else {
              dotClass += 'bg-gray-200 text-gray-500';
            }

            return (
              <div key={step.stepNumber} className="flex items-center gap-1">
                <div className={dotClass}>{isPassed ? '\u2713' : step.stepNumber}</div>
                {step.stepNumber < totalSteps && (
                  <div className={`w-4 h-0.5 ${isPassed ? 'bg-green-300' : 'bg-gray-200'}`} />
                )}
              </div>
            );
          })}
        </div>
        <div className="text-center text-[10px] text-gray-400 mt-1">
          Step {currentStep} of {totalSteps}
        </div>
      </div>

      {/* Step content */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {currentStepData && (
          <>
            {/* Step title & content */}
            <div>
              <h4 className="text-sm font-semibold text-gray-800 mb-1">{currentStepData.title}</h4>
              <div className="text-xs text-gray-700 bg-gray-50 border border-gray-200 rounded p-2.5 leading-relaxed whitespace-pre-wrap">
                {currentStepData.content}
              </div>
            </div>

            {/* Comprehension check */}
            <div className="border border-blue-200 bg-blue-50 rounded-lg p-2.5">
              <div className="text-xs font-medium text-blue-800 mb-1">
                {'\uD83E\uDD14'} Check your understanding
              </div>
              <div className="text-xs text-blue-700 mb-2">
                {currentStepData.comprehensionCheck.question}
              </div>

              {/* Hint toggle */}
              {currentStepData.comprehensionCheck.hint && (
                <div className="mb-2">
                  <button
                    onClick={() => setShowHint(!showHint)}
                    className="text-[10px] text-blue-600 hover:text-blue-800"
                  >
                    {showHint ? '\u25BC Hide hint' : '\u25B6 Show hint'}
                  </button>
                  {showHint && (
                    <div className="text-[10px] text-blue-600 mt-1 italic">
                      {currentStepData.comprehensionCheck.hint}
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Feedback (after check) */}
            {phase === 'feedback' && lastCheck && (
              <div
                className={`border rounded-lg p-2.5 ${
                  lastCheck.isCorrect
                    ? 'bg-green-50 border-green-200'
                    : lastCheck.showAnswer
                      ? 'bg-yellow-50 border-yellow-200'
                      : 'bg-red-50 border-red-200'
                }`}
              >
                <div className="text-xs font-medium mb-1">
                  {lastCheck.isCorrect
                    ? '\u2705 Correct!'
                    : lastCheck.showAnswer
                      ? "\uD83D\uDCA1 Here's the answer"
                      : '\u274C Not quite right'}
                </div>
                <div className="text-xs text-gray-700 mb-1">{lastCheck.feedback}</div>
                {lastCheck.encouragement && (
                  <div className="text-xs text-gray-500 italic">{lastCheck.encouragement}</div>
                )}
                {lastCheck.showAnswer && lastCheck.sampleAnswer && (
                  <div className="text-xs text-gray-800 mt-2 bg-white border border-gray-200 rounded p-2">
                    <span className="font-medium">Expected answer: </span>
                    {lastCheck.sampleAnswer}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* Input area */}
      <div className="px-3 py-2 border-t border-gray-200 space-y-1.5">
        {phase === 'step' && !currentResult?.passed && (
          <>
            <textarea
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  handleSubmitCheck();
                }
              }}
              placeholder="Type your answer..."
              disabled={isChecking}
              className="w-full text-xs border border-gray-300 rounded-lg px-3 py-2 h-16 resize-none focus:outline-none focus:border-blue-400 disabled:bg-gray-50"
            />
            <button
              onClick={handleSubmitCheck}
              disabled={isChecking || !inputValue.trim() || inputValue.trim().length < 10}
              className="w-full text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
            >
              {isChecking ? 'Checking...' : 'Submit Answer'}
            </button>
          </>
        )}

        {phase === 'feedback' && lastCheck && (
          <div className="flex gap-2">
            {lastCheck.isCorrect || lastCheck.showAnswer ? (
              <button
                onClick={currentStep >= totalSteps ? handleWrapUp : handleNextStep}
                className="flex-1 text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                {currentStep >= totalSteps ? '\u2705 Finish' : 'Next Step \u2192'}
              </button>
            ) : (
              <button
                onClick={handleRetryAnswer}
                className="flex-1 text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors"
              >
                Try Again
              </button>
            )}
          </div>
        )}

        {phase === 'step' && currentResult?.passed && (
          <button
            onClick={currentStep >= totalSteps ? handleWrapUp : handleNextStep}
            className="w-full text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 transition-colors"
          >
            {currentStep >= totalSteps ? '\u2705 Finish' : 'Next Step \u2192'}
          </button>
        )}
      </div>
    </div>
  );
}
