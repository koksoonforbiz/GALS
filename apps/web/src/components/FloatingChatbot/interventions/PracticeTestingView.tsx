import { useState, useEffect, useCallback, useRef } from 'react';
import { api } from '../../../lib/api';
import { useActivityLog } from '../../../lib/activity-log';
import { usePageContext } from '../../../contexts/PageContext';
import type { SaveForReviewInput } from '../types';
import { FlaskConical, Trophy, AlertTriangle, Settings } from 'lucide-react';

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

type CoverageMode = 'all' | 'pages' | 'subtopic';
type Phase = 'config' | 'loading' | 'quiz' | 'feedback' | 'results' | 'error';

// Feature flag for the coverage selector (pages-range / subtopic).
// Hidden in the student UI for now — the backend defaults to
// `coverage: { mode: 'all' }` when the field is omitted from the
// generate payload, so behaviour is identical to picking "All material".
// Flip to `true` to re-surface the radio group + page/subtopic inputs
// AND the coverageFallback notice in one line.
const COVERAGE_UI_ENABLED = false;

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
  // Start on the config panel so the student can dial in counts +
  // coverage. The first Generate click flips us into 'loading'.
  const [phase, setPhase] = useState<Phase>('config');
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

  // ── Configuration state ────────────────────────────────────
  // Defaults match the backend's defaults (3 MCQ + 2 short = 5 total)
  // so a student who just clicks Generate gets the same behaviour as
  // before this extension shipped.
  const [mcqCount, setMcqCount] = useState<number>(3);
  const [shortAnswerCount, setShortAnswerCount] = useState<number>(2);
  const [coverageMode, setCoverageMode] = useState<CoverageMode>('all');
  const [pageStart, setPageStart] = useState<string>('1');
  const [pageEnd, setPageEnd] = useState<string>('1');
  const [subtopic, setSubtopic] = useState<string>('');
  // P3 — non-blocking notice when the backend widened the requested
  // coverage to the whole lesson. Cleared on every re-submit so a
  // successful retry hides it.
  const [coverageNotice, setCoverageNotice] = useState<string | null>(null);

  // P3 — read the host PDF's numPages from PageContext so the page-
  // range upper bound defaults to the document's last page (and the
  // input enforces it as `max`). Lifted by StudentCourseViewPage via
  // PdfReader's onPdfMeta. Null when no PDF is open.
  const { pdfNumPages } = usePageContext();

  // When the student first switches to "Pages range" mode and we know
  // numPages, default pageEnd to the last page (and pageStart stays
  // at 1) so the inputs land somewhere sensible without typing.
  useEffect(() => {
    if (coverageMode !== 'pages') return;
    if (pdfNumPages == null) return;
    // Only auto-default when the current values look "untouched"
    // (still the initial pageStart=1 / pageEnd=1). Avoid stomping
    // values the student already typed.
    if (pageStart === '1' && pageEnd === '1') {
      setPageEnd(String(pdfNumPages));
    }
  }, [coverageMode, pdfNumPages, pageStart, pageEnd]);

  const { track } = useActivityLog();
  // Per-question metrics. Tracks when the current question was first
  // shown (for latency-to-answer) and how many times the answer
  // mutated before the student clicked Next (for hesitation signal).
  const questionShownAtRef = useRef<number>(Date.now());
  const answerChangeCountRef = useRef<Record<number, number>>({});
  const interventionStartedAtRef = useRef<number>(Date.now());
  const interventionViewedFiredRef = useRef(false);

  const totalRequested = mcqCount + shortAnswerCount;
  const countsValid =
    Number.isInteger(mcqCount) &&
    Number.isInteger(shortAnswerCount) &&
    mcqCount >= 0 &&
    shortAnswerCount >= 0 &&
    totalRequested >= 1 &&
    totalRequested <= 10;

  const pagesValid =
    coverageMode !== 'pages' ||
    (Number.isInteger(Number(pageStart)) &&
      Number.isInteger(Number(pageEnd)) &&
      Number(pageStart) >= 1 &&
      Number(pageEnd) >= 1 &&
      Number(pageStart) <= Number(pageEnd));
  const subtopicValid = coverageMode !== 'subtopic' || subtopic.trim().length > 0;
  const configValid = countsValid && pagesValid && subtopicValid;

  // Build the payload from the current config state. Pulled out so
  // the retry-from-error path can reuse it.
  const buildPayload = useCallback(() => {
    type Coverage =
      | { mode: 'all' }
      | { mode: 'pages'; pageStart: number; pageEnd: number }
      | { mode: 'subtopic'; subtopic: string };
    let coverage: Coverage = { mode: 'all' };
    if (coverageMode === 'pages') {
      coverage = {
        mode: 'pages',
        pageStart: Number(pageStart),
        pageEnd: Number(pageEnd),
      };
    } else if (coverageMode === 'subtopic') {
      coverage = { mode: 'subtopic', subtopic: subtopic.trim() };
    }
    return {
      selectedText,
      courseId,
      contentId: contentId || undefined,
      pageType,
      // Q2 RAG fallback: when selectedText is empty, the backend uses
      // `topic` to query the course's indexed materials.
      topic: contentTitle || undefined,
      mcqCount,
      shortAnswerCount,
      // When the coverage UI is hidden, omit the field entirely — the
      // backend defaults to `coverage: { mode: 'all' }` per existing
      // behaviour, so omission is equivalent to "All material" without
      // re-introducing the hidden state into the wire payload.
      ...(COVERAGE_UI_ENABLED ? { coverage } : {}),
    };
  }, [
    selectedText,
    courseId,
    contentId,
    pageType,
    contentTitle,
    mcqCount,
    shortAnswerCount,
    coverageMode,
    pageStart,
    pageEnd,
    subtopic,
  ]);

  // Generate practice test
  const generate = useCallback(async () => {
    if (!configValid) return;
    setCoverageNotice(null);
    setPhase('loading');
    try {
      const result = await api.post<{
        interventionId: string;
        questions: GeneratedQuestion[];
        // P2 — set when the backend widened the requested coverage
        // (e.g. zero chunks in the page range after clamping). Used
        // to show a non-blocking inline notice on the quiz phase.
        coverageFallback?: {
          reason:
            | 'no_chunks_in_range'
            | 'invalid_range_after_clamp'
            | 'no_pages_available';
          requestedPageStart?: number;
          requestedPageEnd?: number;
          clampedPageEnd?: number;
        };
      }>('/learning-interventions/practice-testing/generate', buildPayload());
      setInterventionId(result.interventionId);
      setQuestions(result.questions);
      if (result.coverageFallback) {
        const lo = result.coverageFallback.requestedPageStart;
        const hi = result.coverageFallback.requestedPageEnd;
        const ranged = lo != null && hi != null ? `pp. ${lo}-${hi}` : 'the requested pages';
        setCoverageNotice(
          `No content found on ${ranged}; generated from the whole lesson instead.`,
        );
      }
      setPhase('quiz');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate practice test');
      setPhase('error');
    }
  }, [buildPayload, configValid]);

  // Fire INTERVENTION_VIEWED once when the quiz becomes interactive
  // (phase transitions into 'quiz'), and the first QUESTION_VIEWED in
  // the same pass so the timeline has both anchors.
  useEffect(() => {
    if (phase === 'quiz' && !interventionViewedFiredRef.current && interventionId) {
      interventionViewedFiredRef.current = true;
      interventionStartedAtRef.current = Date.now();
      questionShownAtRef.current = Date.now();
      track('INTERVENTION_VIEWED', {
        courseId,
        moduleItemId: contentId ?? undefined,
        interventionId,
        metadata: {
          interventionType: 'PRACTICE_TESTING',
          questionCount: questions.length,
          mcqCount,
          shortAnswerCount,
          coverageMode,
          contentTitle: contentTitle || null,
          hasSelection: Boolean(selectedText && selectedText.length >= 20),
        },
      });
      if (questions.length > 0) {
        track('QUESTION_VIEWED', {
          courseId,
          moduleItemId: contentId ?? undefined,
          interventionId,
          metadata: {
            interventionType: 'PRACTICE_TESTING',
            questionIndex: 0,
            questionType: questions[0]!.type,
          },
        });
      }
    }
  }, [
    phase,
    interventionId,
    questions,
    track,
    courseId,
    contentId,
    contentTitle,
    selectedText,
    mcqCount,
    shortAnswerCount,
    coverageMode,
  ]);

  // Fire QUESTION_VIEWED whenever the student advances to a new
  // question and reset the per-question latency clock.
  useEffect(() => {
    if (phase !== 'quiz' || !interventionId) return;
    // Skip the very first transition (handled by the entry effect above).
    if (currentIndex === 0) return;
    const q = questions[currentIndex];
    if (!q) return;
    questionShownAtRef.current = Date.now();
    track('QUESTION_VIEWED', {
      courseId,
      moduleItemId: contentId ?? undefined,
      interventionId,
      metadata: {
        interventionType: 'PRACTICE_TESTING',
        questionIndex: currentIndex,
        questionType: q.type,
      },
    });
  }, [currentIndex, phase, interventionId, questions, track, courseId, contentId]);

  const handleAnswerSelect = (answer: string) => {
    // Count any change to the answer (excluding the very first set).
    setUserAnswers((prev) => {
      if (prev[currentIndex] !== undefined && prev[currentIndex] !== answer) {
        answerChangeCountRef.current[currentIndex] =
          (answerChangeCountRef.current[currentIndex] ?? 0) + 1;
      }
      return { ...prev, [currentIndex]: answer };
    });
  };

  const handleSubmitAnswer = async () => {
    // Record per-question metrics BEFORE advancing — we use latency
    // (time from QUESTION_VIEWED to here) and answer-change count.
    // Correctness isn't known yet on a per-question basis; it's emitted
    // for all questions together once the API grades them in the
    // submit branch below.
    const latencyMs = Date.now() - questionShownAtRef.current;
    const q = questions[currentIndex]!;
    const answeredText = userAnswers[currentIndex] ?? '';
    track('QUESTION_ANSWERED', {
      courseId,
      moduleItemId: contentId ?? undefined,
      interventionId: interventionId ?? undefined,
      metadata: {
        interventionType: 'PRACTICE_TESTING',
        questionIndex: currentIndex,
        questionType: q.type,
        latencyMs,
        answerChanges: answerChangeCountRef.current[currentIndex] ?? 0,
        // Truncate answer text — short answers can be long free text.
        answer: answeredText.slice(0, 500),
      },
    });

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

      // Emit INTERVENTION_COMPLETED with rollup metrics. Pairs with the
      // earlier INTERVENTION_TRIGGERED (server-side on generate) and
      // INTERVENTION_VIEWED so total time-in-intervention can be
      // computed from the timestamp delta.
      const totalDurationMs = Date.now() - interventionStartedAtRef.current;
      const correctCount = result.results.filter((r) => r.correct).length;
      track('INTERVENTION_COMPLETED', {
        courseId,
        moduleItemId: contentId ?? undefined,
        interventionId,
        metadata: {
          interventionType: 'PRACTICE_TESTING',
          totalQuestions: questions.length,
          correctCount,
          score: result.score,
          percentCorrect:
            questions.length > 0 ? Math.round((correctCount / questions.length) * 100) : 0,
          totalDurationMs,
          completed: true,
        },
      });
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
    // Send the student back to the config panel so they can tweak
    // counts/coverage before re-running.
    setPhase('config');
    interventionViewedFiredRef.current = false;
  };

  // ─── Configuration Phase ────────────────────────────────
  if (phase === 'config') {
    return (
      <div className="flex-1 flex flex-col overflow-hidden">
        <div className="px-3 py-2 border-b border-gray-100 bg-gray-50 flex items-center gap-2">
          <Settings size={14} className="text-gray-500" />
          <span className="text-xs font-medium text-gray-700">Configure practice test</span>
        </div>
        <div className="flex-1 overflow-y-auto p-3 space-y-3">
          {/* Counts */}
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium text-gray-700">Question mix</div>
              {/* P3 — one-click reset to the canonical 3 MCQ + 2 short
                  default so a student who tweaked the steppers can
                  bounce back without retyping. Matches the hard-coded
                  backend fallback. */}
              <button
                type="button"
                onClick={() => {
                  setMcqCount(3);
                  setShortAnswerCount(2);
                }}
                className="text-[11px] text-blue-600 hover:text-blue-800 underline underline-offset-2"
              >
                Use defaults (3 MCQ + 2 short-answer)
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className="text-xs text-gray-600 flex flex-col gap-1">
                Multiple-choice
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={mcqCount}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(10, Math.floor(Number(e.target.value) || 0)));
                    setMcqCount(v);
                  }}
                  className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                />
              </label>
              <label className="text-xs text-gray-600 flex flex-col gap-1">
                Short-answer
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={shortAnswerCount}
                  onChange={(e) => {
                    const v = Math.max(0, Math.min(10, Math.floor(Number(e.target.value) || 0)));
                    setShortAnswerCount(v);
                  }}
                  className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                />
              </label>
            </div>
            <div className="text-[11px] text-gray-500">
              Total: {totalRequested} (must be 1-10)
            </div>
            {!countsValid && (
              <div className="text-[11px] text-amber-600 flex items-center gap-1">
                <AlertTriangle size={11} />
                {totalRequested < 1
                  ? 'Need at least 1 question total.'
                  : `Max 10 questions total — currently ${totalRequested}.`}
              </div>
            )}
          </div>

          {/* Coverage — gated by COVERAGE_UI_ENABLED. The state hooks
              and validators above stay declared so re-enabling is a
              one-line flag flip with no other edits needed. */}
          {COVERAGE_UI_ENABLED && (
            <div className="space-y-2">
              <div className="text-xs font-medium text-gray-700">Coverage</div>
              <div className="flex flex-col gap-1.5">
                {(['all', 'pages', 'subtopic'] as const).map((mode) => (
                  <label key={mode} className="text-xs text-gray-700 flex items-center gap-2">
                    <input
                      type="radio"
                      name="coverage-mode"
                      value={mode}
                      checked={coverageMode === mode}
                      onChange={() => setCoverageMode(mode)}
                      className="text-blue-600"
                    />
                    {mode === 'all' && 'All material'}
                    {mode === 'pages' && 'Pages range'}
                    {mode === 'subtopic' && 'Subtopic'}
                  </label>
                ))}
              </div>

              {coverageMode === 'pages' && (
                <div className="grid grid-cols-2 gap-2 mt-1">
                  <label className="text-xs text-gray-600 flex flex-col gap-1">
                    From page
                    <input
                      type="number"
                      min={1}
                      // P3 — enforce the document's last page as the
                      // upper bound on the input element when we know
                      // it. The backend clamps + coverageFallback
                      // anyway, but this nudges the student to a valid
                      // value at typing time.
                      max={pdfNumPages ?? undefined}
                      value={pageStart}
                      onChange={(e) => setPageStart(e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                    />
                  </label>
                  <label className="text-xs text-gray-600 flex flex-col gap-1">
                    To page
                    <input
                      type="number"
                      min={1}
                      max={pdfNumPages ?? undefined}
                      value={pageEnd}
                      onChange={(e) => setPageEnd(e.target.value)}
                      className="text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                    />
                  </label>
                  {pdfNumPages != null && (
                    <div className="col-span-2 text-[11px] text-gray-500">
                      Document has {pdfNumPages} page{pdfNumPages === 1 ? '' : 's'}.
                    </div>
                  )}
                  {!pagesValid && (
                    <div className="col-span-2 text-[11px] text-amber-600 flex items-center gap-1">
                      <AlertTriangle size={11} />
                      Start must be ≥1 and ≤ end.
                    </div>
                  )}
                </div>
              )}

              {coverageMode === 'subtopic' && (
                <div className="mt-1">
                  <input
                    type="text"
                    value={subtopic}
                    onChange={(e) => setSubtopic(e.target.value)}
                    placeholder="e.g. mitosis, Newton's third law"
                    className="w-full text-xs border border-gray-300 rounded px-2 py-1 focus:outline-none focus:border-blue-400"
                  />
                  {!subtopicValid && (
                    <div className="text-[11px] text-amber-600 flex items-center gap-1 mt-1">
                      <AlertTriangle size={11} />
                      Enter a subtopic to focus on.
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="px-3 py-2 border-t border-gray-200 flex gap-2">
          <button
            onClick={onBack}
            className="text-xs text-gray-600 px-3 py-2 rounded-lg border border-gray-300 hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={() => void generate()}
            disabled={!configValid}
            className="flex-1 text-xs bg-blue-600 text-white px-3 py-2 rounded-lg hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed transition-colors"
          >
            Generate test
          </button>
        </div>
      </div>
    );
  }

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
        {/* P3 — non-blocking notice when the requested coverage was
            widened (e.g. zero chunks in the page range). Shown above
            the question so the student understands why the test
            doesn't reflect their narrowing. Dismissible via the X.
            Gated on COVERAGE_UI_ENABLED — when the coverage selector
            is hidden no coverage field is sent so the backend never
            returns a fallback, but we keep the rendering code so
            re-enabling is one line. */}
        {COVERAGE_UI_ENABLED && coverageNotice && (
          <div className="mx-3 mt-2 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-2 text-[11px] text-amber-700">
            <AlertTriangle size={12} className="mt-0.5 flex-shrink-0" />
            <span className="flex-1">{coverageNotice}</span>
            <button
              type="button"
              onClick={() => setCoverageNotice(null)}
              className="text-amber-600 hover:text-amber-800"
              aria-label="Dismiss notice"
            >
              ×
            </button>
          </div>
        )}

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
            {submitting ? 'Submitting...' : isLast ? 'Submit All Answers' : 'Next →'}
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
                {r.correct ? '✓' : '✗'}
              </span>
              <span className="text-xs text-gray-800 flex-1 truncate">{r.question}</span>
              <span className="text-xs text-gray-400">
                {expandedResult === i ? '▲' : '▼'}
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
          {saved ? '✓ Saved to My Reviews' : 'Save to My Reviews'}
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
