import { useState, useEffect, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { MathText } from '../../components/MathText';

interface MCQOption {
  id: string;
  text: string;
  isCorrect?: boolean;
}

interface Question {
  id: string;
  prompt: string;
  type: 'MCQ_SINGLE' | 'MCQ_MULTI' | string;
  maxScore: number;
  options: MCQOption[] | null;
}

interface AssessmentQuestion {
  id: string;
  questionId: string;
  orderIndex: number;
  points: number | null;
  section: string | null;
  question: Question;
}

interface Assessment {
  id: string;
  title: string;
  description: string | null;
  course: { id: string; title: string };
  questions: AssessmentQuestion[];
}

interface GradingResult {
  score: number;
  autoFeedback: string | null;
}

interface AttemptResponse {
  id: string;
  currentScore: number | null;
  gradingResults: GradingResult[];
  question: { maxScore: number; options: MCQOption[] | null };
}

interface ExistingAttempt {
  id: string;
  questionId: string;
  assessmentId: string | null;
  status: string;
  selectedOptionIds: unknown;
  gradingResults: GradingResult[];
  question: {
    id: string;
    prompt: string;
    type: string;
    maxScore: number;
    options: MCQOption[] | null;
  };
}

interface SubmitResult {
  questionId: string;
  section: string | null;
  prompt: string;
  score: number | null;
  maxScore: number;
  status: 'correct' | 'partial' | 'incorrect' | 'skipped';
  autoFeedback: string | null;
  selectedOptionIds: string[];
  correctOptionIds: string[];
  options: MCQOption[];
}

export function AssessmentAttemptPage() {
  const { assessmentId } = useParams<{ assessmentId: string }>();
  const navigate = useNavigate();

  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [loading, setLoading] = useState(true);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Map<string, string[]>>(new Map());
  const [submitting, setSubmitting] = useState(false);
  const [submitProgress, setSubmitProgress] = useState({ done: 0, total: 0 });
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [results, setResults] = useState<SubmitResult[] | null>(null);

  useEffect(() => {
    if (!assessmentId) return;
    Promise.all([
      apiFetch<Assessment>(`/assessments/${assessmentId}`),
      apiFetch<ExistingAttempt[]>('/attempts/my'),
    ])
      .then(([assessmentData, myAttempts]) => {
        setAssessment(assessmentData);

        const submitted = myAttempts.filter(
          (a) =>
            a.assessmentId === assessmentId && (a.status === 'submitted' || a.status === 'graded'),
        );

        if (submitted.length > 0) {
          const byQuestionId = new Map(submitted.map((a) => [a.questionId, a]));
          const reconstructed: SubmitResult[] = assessmentData.questions.map((aq) => {
            const attempt = byQuestionId.get(aq.questionId);
            const maxScore = aq.points ?? aq.question.maxScore;
            if (!attempt) {
              return {
                questionId: aq.questionId,
                section: aq.section,
                prompt: aq.question.prompt,
                score: 0,
                maxScore,
                status: 'skipped' as const,
                autoFeedback: null,
                selectedOptionIds: [],
                correctOptionIds: (aq.question.options ?? [])
                  .filter((o) => o.isCorrect)
                  .map((o) => o.id),
                options: aq.question.options ?? [],
              };
            }
            const grading = attempt.gradingResults[0];
            const score = grading?.score ?? null;
            const options = attempt.question.options ?? aq.question.options ?? [];
            const correctOptionIds = options.filter((o) => o.isCorrect).map((o) => o.id);
            const selectedOptionIds = (attempt.selectedOptionIds as string[]) ?? [];
            const status: SubmitResult['status'] =
              score === null
                ? 'incorrect'
                : score >= maxScore
                  ? 'correct'
                  : score > 0
                    ? 'partial'
                    : 'incorrect';
            return {
              questionId: aq.questionId,
              section: aq.section,
              prompt: aq.question.prompt,
              score,
              maxScore,
              status,
              autoFeedback: grading?.autoFeedback ?? null,
              selectedOptionIds,
              correctOptionIds,
              options,
            };
          });
          setResults(reconstructed);
        }
      })
      .catch((err) =>
        setFetchError(err instanceof Error ? err.message : 'Failed to load assessment'),
      )
      .finally(() => setLoading(false));
  }, [assessmentId]);

  const sections = useMemo(() => {
    if (!assessment) return [];
    const map = new Map<string, AssessmentQuestion[]>();
    for (const aq of assessment.questions) {
      const key = aq.section ?? 'General';
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(aq);
    }
    return Array.from(map.entries()).map(([section, questions]) => ({ section, questions }));
  }, [assessment]);

  const answeredCount = useMemo(() => {
    if (!assessment) return 0;
    return assessment.questions.filter((aq) => (answers.get(aq.questionId)?.length ?? 0) > 0)
      .length;
  }, [assessment, answers]);

  const selectSingle = (questionId: string, optionId: string) => {
    setAnswers((prev) => new Map(prev).set(questionId, [optionId]));
  };

  const toggleMulti = (questionId: string, optionId: string) => {
    setAnswers((prev) => {
      const next = new Map(prev);
      const current = next.get(questionId) ?? [];
      next.set(
        questionId,
        current.includes(optionId)
          ? current.filter((id) => id !== optionId)
          : [...current, optionId],
      );
      return next;
    });
  };

  const handleSubmit = async () => {
    if (!assessment || !assessmentId) return;
    const qs = assessment.questions;
    setSubmitting(true);
    setSubmitProgress({ done: 0, total: qs.length });
    setSubmitError(null);

    const resultsArr: SubmitResult[] = [];

    for (let i = 0; i < qs.length; i++) {
      const aq = qs[i]!;
      const questionId = aq.questionId;
      const selectedOptionIds = answers.get(questionId) ?? [];
      const maxScore = aq.points ?? aq.question.maxScore;

      if (selectedOptionIds.length === 0) {
        resultsArr.push({
          questionId,
          section: aq.section,
          prompt: aq.question.prompt,
          score: 0,
          maxScore,
          status: 'skipped',
          autoFeedback: null,
          selectedOptionIds: [],
          correctOptionIds: (aq.question.options ?? []).filter((o) => o.isCorrect).map((o) => o.id),
          options: aq.question.options ?? [],
        });
        setSubmitProgress({ done: i + 1, total: qs.length });
        continue;
      }

      try {
        const attempt = await apiFetch<{ id: string }>('/attempts', {
          method: 'POST',
          body: JSON.stringify({ questionId, assessmentId }),
        });

        const submitted = await apiFetch<AttemptResponse>(`/attempts/${attempt.id}/submit`, {
          method: 'POST',
          body: JSON.stringify({ selectedOptionIds }),
        });

        const grading = submitted.gradingResults?.[0];
        const score = grading?.score ?? submitted.currentScore ?? null;
        const options = submitted.question?.options ?? aq.question.options ?? [];
        const correctOptionIds = options.filter((o) => o.isCorrect).map((o) => o.id);

        const status: SubmitResult['status'] =
          score === null
            ? 'incorrect'
            : score >= maxScore
              ? 'correct'
              : score > 0
                ? 'partial'
                : 'incorrect';

        resultsArr.push({
          questionId,
          section: aq.section,
          prompt: aq.question.prompt,
          score,
          maxScore,
          status,
          autoFeedback: grading?.autoFeedback ?? null,
          selectedOptionIds,
          correctOptionIds,
          options,
        });
      } catch (err) {
        resultsArr.push({
          questionId,
          section: aq.section,
          prompt: aq.question.prompt,
          score: null,
          maxScore,
          status: 'incorrect',
          autoFeedback: err instanceof Error ? err.message : 'Submission failed',
          selectedOptionIds,
          correctOptionIds: [],
          options: aq.question.options ?? [],
        });
      }

      setSubmitProgress({ done: i + 1, total: qs.length });
    }

    setResults(resultsArr);
    setSubmitting(false);
  };

  // ─── Loading / error ──────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-gray-500">
        Loading assessment...
      </div>
    );
  }

  if (fetchError || !assessment) {
    return (
      <div className="max-w-xl mx-auto mt-8">
        <div className="p-4 bg-red-50 text-red-700 rounded-lg">
          {fetchError ?? 'Assessment not found.'}
        </div>
        <button
          onClick={() => navigate('/student/assessments')}
          className="mt-4 text-sm text-blue-600 hover:underline"
        >
          ← Back to Assessments
        </button>
      </div>
    );
  }

  // ─── Results view ─────────────────────────────────────────────────────────

  if (results) {
    const correct = results.filter((r) => r.status === 'correct').length;
    const skipped = results.filter((r) => r.status === 'skipped').length;
    const totalScore = results.reduce((s, r) => s + (r.score ?? 0), 0);
    const maxTotalScore = results.reduce((s, r) => s + r.maxScore, 0);
    const pct = maxTotalScore > 0 ? Math.round((totalScore / maxTotalScore) * 100) : 0;

    return (
      <div className="max-w-3xl mx-auto pb-16">
        <div className="mb-8 p-6 bg-blue-50 rounded-xl border border-blue-200">
          <h2 className="text-xl font-bold text-gray-900 mb-0.5">{assessment.title}</h2>
          <p className="text-sm text-gray-500 mb-4">{assessment.course.title}</p>
          <div className="flex flex-wrap gap-8">
            <div className="text-center">
              <div className="text-3xl font-bold text-blue-700">{pct}%</div>
              <div className="text-xs text-gray-500 mt-0.5">Score</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-green-700">
                {correct}/{results.length}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Correct</div>
            </div>
            <div className="text-center">
              <div className="text-3xl font-bold text-gray-700">
                {totalScore}/{maxTotalScore}
              </div>
              <div className="text-xs text-gray-500 mt-0.5">Points</div>
            </div>
            {skipped > 0 && (
              <div className="text-center">
                <div className="text-3xl font-bold text-yellow-600">{skipped}</div>
                <div className="text-xs text-gray-500 mt-0.5">Skipped</div>
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          {results.map((result, index) => {
            const borderClass =
              result.status === 'correct'
                ? 'border-green-200 bg-green-50'
                : result.status === 'skipped'
                  ? 'border-gray-200 bg-gray-50'
                  : result.status === 'partial'
                    ? 'border-yellow-200 bg-yellow-50'
                    : 'border-red-200 bg-red-50';

            const badgeClass =
              result.status === 'correct'
                ? 'bg-green-100 text-green-800'
                : result.status === 'skipped'
                  ? 'bg-gray-100 text-gray-600'
                  : result.status === 'partial'
                    ? 'bg-yellow-100 text-yellow-800'
                    : 'bg-red-100 text-red-700';

            const badgeText =
              result.status === 'correct'
                ? `✓ ${result.score}/${result.maxScore}`
                : result.status === 'partial'
                  ? `~ ${result.score}/${result.maxScore}`
                  : result.status === 'skipped'
                    ? 'Skipped'
                    : `✗ 0/${result.maxScore}`;

            return (
              <div key={result.questionId} className={`p-5 rounded-xl border ${borderClass}`}>
                <div className="flex items-start justify-between gap-4 mb-3">
                  <p className="text-sm font-medium text-gray-800 flex-1">
                    <span className="text-gray-400 font-normal mr-2">Q{index + 1}.</span>
                    <MathText text={result.prompt} />
                  </p>
                  <span
                    className={`text-xs px-2 py-1 rounded-full font-semibold shrink-0 ${badgeClass}`}
                  >
                    {badgeText}
                  </span>
                </div>
                {result.options.length > 0 && (
                  <div className="space-y-1">
                    {result.options.map((opt) => {
                      const wasSelected = result.selectedOptionIds.includes(opt.id);
                      const isCorrect = result.correctOptionIds.includes(opt.id);
                      return (
                        <div
                          key={opt.id}
                          className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-2 ${
                            isCorrect
                              ? 'bg-green-100 text-green-800 font-medium'
                              : wasSelected
                                ? 'bg-red-100 text-red-700'
                                : 'bg-white/60 text-gray-500'
                          }`}
                        >
                          <span className="shrink-0 w-3">
                            {isCorrect ? '✓' : wasSelected ? '✗' : '·'}
                          </span>
                          <MathText text={opt.text} />
                        </div>
                      );
                    })}
                  </div>
                )}
                {result.autoFeedback && result.status !== 'correct' && (
                  <p className="text-xs text-gray-600 mt-2 italic">{result.autoFeedback}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-8 flex justify-center">
          <button
            onClick={() => navigate('/student/assessments')}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            Back to Assessments
          </button>
        </div>
      </div>
    );
  }

  // ─── Question answering view ──────────────────────────────────────────────

  return (
    <div className="max-w-3xl mx-auto pb-16">
      {/* Header */}
      <div className="mb-6">
        <button
          onClick={() => navigate('/student/assessments')}
          className="text-sm text-blue-600 hover:text-blue-800 mb-3 inline-flex items-center gap-1"
        >
          ← Back
        </button>
        <h2 className="text-2xl font-bold text-gray-900">{assessment.title}</h2>
        <p className="text-sm text-gray-500 mt-0.5">{assessment.course.title}</p>
        {assessment.description && (
          <p className="text-gray-600 mt-2 text-sm">{assessment.description}</p>
        )}
        <p className="mt-3 text-sm text-gray-500">
          <span
            className={
              answeredCount === assessment.questions.length ? 'text-green-600 font-medium' : ''
            }
          >
            {answeredCount}
          </span>{' '}
          / {assessment.questions.length} answered
        </p>
      </div>

      {submitError && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{submitError}</div>
      )}

      {/* Questions grouped by section */}
      <div className="space-y-8">
        {sections.map(({ section, questions }) => (
          <div key={section}>
            <h3 className="text-sm font-semibold text-gray-500 uppercase tracking-wide mb-4 pb-2 border-b border-gray-200">
              {section}
            </h3>
            <div className="space-y-5">
              {questions.map((aq) => {
                const q = aq.question;
                const globalIndex = assessment.questions.indexOf(aq);
                const selected = answers.get(aq.questionId) ?? [];
                const options = (q.options ?? []) as MCQOption[];
                const isMulti = q.type === 'MCQ_MULTI';

                return (
                  <div
                    key={aq.id}
                    className="bg-white rounded-xl border border-gray-200 p-5 shadow-sm"
                  >
                    <p className="text-sm font-medium text-gray-800 mb-3 leading-relaxed">
                      <span className="text-gray-400 font-normal mr-2">Q{globalIndex + 1}.</span>
                      <MathText text={q.prompt} />
                    </p>
                    {isMulti && <p className="text-xs text-blue-600 mb-2">Select all that apply</p>}
                    <div className="space-y-2">
                      {options.map((opt) => {
                        const isSelected = selected.includes(opt.id);
                        return (
                          <label
                            key={opt.id}
                            className={`flex items-center gap-3 px-3 py-2.5 rounded-lg border cursor-pointer transition-colors select-none ${
                              isSelected
                                ? 'bg-blue-50 border-blue-400 text-blue-800'
                                : 'border-gray-200 hover:bg-gray-50 text-gray-700'
                            }`}
                          >
                            <input
                              type={isMulti ? 'checkbox' : 'radio'}
                              name={`q-${aq.questionId}`}
                              checked={isSelected}
                              onChange={() =>
                                isMulti
                                  ? toggleMulti(aq.questionId, opt.id)
                                  : selectSingle(aq.questionId, opt.id)
                              }
                              className="shrink-0 accent-blue-600"
                            />
                            <span className="text-sm">
                              <MathText text={opt.text} />
                            </span>
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Footer submit */}
      <div className="mt-10 flex items-center justify-between gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm sticky bottom-4">
        <p className="text-sm text-gray-600">
          {answeredCount} / {assessment.questions.length} answered
          {assessment.questions.length - answeredCount > 0 && (
            <span className="text-yellow-600 ml-1">
              ({assessment.questions.length - answeredCount} unanswered will be skipped)
            </span>
          )}
        </p>
        <button
          onClick={handleSubmit}
          disabled={submitting || answeredCount === 0}
          className="px-6 py-2.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors font-medium text-sm shrink-0"
        >
          {submitting
            ? `Submitting… (${submitProgress.done}/${submitProgress.total})`
            : 'Submit Assessment'}
        </button>
      </div>
    </div>
  );
}
