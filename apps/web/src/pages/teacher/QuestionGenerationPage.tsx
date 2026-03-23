import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface SourceDocument {
  id: string;
  title: string;
  filename: string;
  chunkCount: number;
  indexedAt: string | null;
}

interface GeneratedQuestion {
  index: number;
  questionText: string;
  type: 'mcq' | 'true_false' | 'short_answer' | 'open_ended';
  difficulty: 'easy' | 'medium' | 'hard';
  difficultyJustification?: string;
  knowledgeTags: string[];
  options?: { label: string; text: string; isCorrect: boolean }[];
  answerKey: Record<string, unknown>;
  reviewStatus: 'pending' | 'approved' | 'rejected' | 'edited';
  approvedQuestionId?: string;
}

interface GenerationJob {
  id: string;
  courseId: string;
  status: string;
  questionCount: number;
  generatedQuestions: GeneratedQuestion[] | null;
  approvedCount: number;
  rejectedCount: number;
  error: string | null;
  createdAt: string;
}

interface KnowledgeComponent {
  id: string;
  code: string;
  label: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const QUESTION_TYPES = [
  { value: 'mcq', label: 'Multiple Choice (MCQ)' },
  { value: 'true_false', label: 'True/False' },
  { value: 'short_answer', label: 'Short Answer' },
  { value: 'open_ended', label: 'Open-Ended / Essay' },
];

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: '#22c55e',
  medium: '#f59e0b',
  hard: '#ef4444',
};

const TYPE_LABELS: Record<string, string> = {
  mcq: 'MCQ',
  true_false: 'True/False',
  short_answer: 'Short Answer',
  open_ended: 'Open-Ended',
};

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function QuestionGenerationPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();

  // Step state: configure | progress | review
  const [step, setStep] = useState<'configure' | 'progress' | 'review'>('configure');

  // Configure step
  const [documents, setDocuments] = useState<SourceDocument[]>([]);
  const [selectedDocs, setSelectedDocs] = useState<string[]>([]);
  const [selectedTypes, setSelectedTypes] = useState<string[]>(['mcq', 'short_answer']);
  const [questionCount, setQuestionCount] = useState(10);
  const [difficultyMode, setDifficultyMode] = useState<'auto' | 'custom'>('auto');
  const [difficultyMix, setDifficultyMix] = useState({ easy: 3, medium: 4, hard: 3 });
  const [additionalInstructions, setAdditionalInstructions] = useState('');
  const [loading, setLoading] = useState(false);

  // Progress step
  const [jobId, setJobId] = useState<string | null>(null);
  const [jobStatus, setJobStatus] = useState<string>('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Review step
  const [job, setJob] = useState<GenerationJob | null>(null);
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editForm, setEditForm] = useState<Partial<GeneratedQuestion>>({});
  const [kcs, setKcs] = useState<KnowledgeComponent[]>([]);
  const [reviewAction, setReviewAction] = useState<string | null>(null);
  const [courseName, setCourseName] = useState('');

  // Load documents and KCs on mount
  useEffect(() => {
    if (!courseId) return;
    api
      .get<SourceDocument[]>(`/courses/${courseId}/documents`)
      .then(setDocuments)
      .catch(() => {});
    api
      .get<{ id: string; title: string }>(`/courses/${courseId}`)
      .then((c) => setCourseName(c.title))
      .catch(() => {});
    // Load KCs for the course (via topics)
    api
      .get<KnowledgeComponent[]>(`/proposed-kcs?courseId=${courseId}&status=APPROVED`)
      .then(setKcs)
      .catch(() => {});
  }, [courseId]);

  // Poll job status
  const pollJobStatus = useCallback((id: string) => {
    if (pollRef.current) clearInterval(pollRef.current);
    pollRef.current = setInterval(async () => {
      try {
        const j = await api.get<GenerationJob>(`/question-generation/jobs/${id}`);
        setJobStatus(j.status);

        if (j.status === 'REVIEW_READY' || j.status === 'COMPLETED') {
          if (pollRef.current) clearInterval(pollRef.current);
          setJob(j);
          setStep('review');
        } else if (j.status === 'FAILED') {
          if (pollRef.current) clearInterval(pollRef.current);
          setJob(j);
        }
      } catch {
        /* ignore polling errors */
      }
    }, 2000);
  }, []);

  useEffect(() => {
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, []);

  // ─── Handlers ────────────────────────────────────────────

  const handleGenerate = async () => {
    if (!courseId || selectedDocs.length === 0 || selectedTypes.length === 0) return;
    setLoading(true);
    try {
      const result = await api.post<{ jobId: string; status: string }>(
        '/question-generation/generate',
        {
          courseId,
          sourceDocumentIds: selectedDocs,
          questionTypes: selectedTypes,
          questionCount,
          difficultyMix: difficultyMode === 'custom' ? difficultyMix : undefined,
          additionalInstructions: additionalInstructions || undefined,
        },
      );
      setJobId(result.jobId);
      setJobStatus('PENDING');
      setStep('progress');
      pollJobStatus(result.jobId);
    } catch (err: any) {
      alert(err.message || 'Failed to start generation');
    } finally {
      setLoading(false);
    }
  };

  const handleReview = async (index: number, action: 'approve' | 'reject' | 'edit') => {
    if (!jobId) return;
    setReviewAction(`${index}-${action}`);
    try {
      const body: any = { action };
      if (action === 'edit') {
        body.editedQuestion = editForm;
      }
      await api.patch<unknown>(
        `/question-generation/jobs/${jobId}/questions/${index}/review`,
        body,
      );
      // Refresh job
      const updated = await api.get<GenerationJob>(`/question-generation/jobs/${jobId}`);
      setJob(updated);
      setEditingIndex(null);
      setEditForm({});
    } catch (err: any) {
      alert(err.message || 'Failed to review question');
    } finally {
      setReviewAction(null);
    }
  };

  const handleApproveAll = async () => {
    if (!jobId) return;
    setReviewAction('approve-all');
    try {
      await api.post<unknown>(`/question-generation/jobs/${jobId}/approve-all`);
      const updated = await api.get<GenerationJob>(`/question-generation/jobs/${jobId}`);
      setJob(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to approve all');
    } finally {
      setReviewAction(null);
    }
  };

  const handleRegenerate = async () => {
    if (!jobId || !job) return;
    setReviewAction('regenerate');
    try {
      await api.post<unknown>(`/question-generation/jobs/${jobId}/regenerate`, {
        count: job.rejectedCount || 3,
      });
      const updated = await api.get<GenerationJob>(`/question-generation/jobs/${jobId}`);
      setJob(updated);
    } catch (err: any) {
      alert(err.message || 'Failed to regenerate');
    } finally {
      setReviewAction(null);
    }
  };

  const startEdit = (q: GeneratedQuestion) => {
    setEditingIndex(q.index);
    setEditForm({
      questionText: q.questionText,
      difficulty: q.difficulty,
      knowledgeTags: [...q.knowledgeTags],
      options: q.options ? q.options.map((o) => ({ ...o })) : undefined,
      answerKey: { ...q.answerKey },
    });
  };

  const toggleDoc = (docId: string) => {
    setSelectedDocs((prev) =>
      prev.includes(docId) ? prev.filter((d) => d !== docId) : [...prev, docId],
    );
  };

  const toggleType = (type: string) => {
    setSelectedTypes((prev) =>
      prev.includes(type) ? prev.filter((t) => t !== type) : [...prev, type],
    );
  };

  // ─── Render ──────────────────────────────────────────────

  const questions = (job?.generatedQuestions || []) as GeneratedQuestion[];
  const pendingCount = questions.filter((q) => q.reviewStatus === 'pending').length;
  const approvedCount = questions.filter(
    (q) => q.reviewStatus === 'approved' || q.reviewStatus === 'edited',
  ).length;
  const rejectedCount = questions.filter((q) => q.reviewStatus === 'rejected').length;

  return (
    <div style={{ maxWidth: 900, margin: '0 auto', padding: 24 }}>
      {/* Header */}
      <div style={{ marginBottom: 24 }}>
        <button
          onClick={() => navigate(-1)}
          style={{
            background: 'none',
            border: 'none',
            color: '#6366f1',
            cursor: 'pointer',
            fontSize: 14,
            marginBottom: 8,
          }}
        >
          &larr; Back
        </button>
        <h1 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>AI Question Generator</h1>
        {courseName && <p style={{ color: '#6b7280', margin: '4px 0 0' }}>Course: {courseName}</p>}
      </div>

      {/* ─── Step 1: Configure ──────────────────────────── */}
      {step === 'configure' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
          {/* Source Materials */}
          <fieldset
            style={{
              border: '1px solid #e5e7eb',
              borderRadius: 8,
              padding: 16,
            }}
          >
            <legend style={{ fontWeight: 600, padding: '0 8px' }}>Source Materials</legend>
            <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 12px' }}>
              Select documents to generate questions from
            </p>
            {documents.length === 0 && (
              <p style={{ color: '#9ca3af', fontStyle: 'italic' }}>
                No documents uploaded. Upload materials in the Course Studio first.
              </p>
            )}
            {documents.map((doc) => (
              <label
                key={doc.id}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '6px 0',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedDocs.includes(doc.id)}
                  onChange={() => toggleDoc(doc.id)}
                />
                <span>{doc.title || doc.filename}</span>
                {doc.chunkCount > 0 && (
                  <span style={{ color: '#9ca3af', fontSize: 12 }}>({doc.chunkCount} chunks)</span>
                )}
                {!doc.indexedAt && (
                  <span style={{ color: '#f59e0b', fontSize: 12 }}>Not indexed</span>
                )}
              </label>
            ))}
          </fieldset>

          {/* Question Types */}
          <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
            <legend style={{ fontWeight: 600, padding: '0 8px' }}>Question Types</legend>
            {QUESTION_TYPES.map((qt) => (
              <label
                key={qt.value}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '4px 0',
                  cursor: 'pointer',
                }}
              >
                <input
                  type="checkbox"
                  checked={selectedTypes.includes(qt.value)}
                  onChange={() => toggleType(qt.value)}
                />
                {qt.label}
              </label>
            ))}
          </fieldset>

          {/* Count & Difficulty */}
          <div style={{ display: 'flex', gap: 16 }}>
            <fieldset
              style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, flex: 1 }}
            >
              <legend style={{ fontWeight: 600, padding: '0 8px' }}>Number of Questions</legend>
              <select
                value={questionCount}
                onChange={(e) => setQuestionCount(Number(e.target.value))}
                style={{ width: '100%', padding: 8, borderRadius: 4, border: '1px solid #d1d5db' }}
              >
                {[5, 10, 15, 20, 25, 30].map((n) => (
                  <option key={n} value={n}>
                    {n}
                  </option>
                ))}
              </select>
            </fieldset>

            <fieldset
              style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, flex: 2 }}
            >
              <legend style={{ fontWeight: 600, padding: '0 8px' }}>Difficulty Mix</legend>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <input
                  type="radio"
                  checked={difficultyMode === 'auto'}
                  onChange={() => setDifficultyMode('auto')}
                />
                Let AI decide
              </label>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <input
                  type="radio"
                  checked={difficultyMode === 'custom'}
                  onChange={() => setDifficultyMode('custom')}
                />
                Custom:
              </label>
              {difficultyMode === 'custom' && (
                <div style={{ display: 'flex', gap: 12, marginTop: 8, marginLeft: 24 }}>
                  {(['easy', 'medium', 'hard'] as const).map((d) => (
                    <label key={d} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ textTransform: 'capitalize', fontSize: 13 }}>{d}:</span>
                      <input
                        type="number"
                        min={0}
                        max={30}
                        value={difficultyMix[d]}
                        onChange={(e) =>
                          setDifficultyMix((prev) => ({ ...prev, [d]: Number(e.target.value) }))
                        }
                        style={{
                          width: 50,
                          padding: 4,
                          borderRadius: 4,
                          border: '1px solid #d1d5db',
                          textAlign: 'center',
                        }}
                      />
                    </label>
                  ))}
                </div>
              )}
            </fieldset>
          </div>

          {/* Additional Instructions */}
          <fieldset style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
            <legend style={{ fontWeight: 600, padding: '0 8px' }}>
              Additional Instructions (optional)
            </legend>
            <textarea
              value={additionalInstructions}
              onChange={(e) => setAdditionalInstructions(e.target.value)}
              placeholder="e.g., Focus on chapters 1-2. Include questions about data source types."
              rows={3}
              style={{
                width: '100%',
                padding: 8,
                borderRadius: 4,
                border: '1px solid #d1d5db',
                resize: 'vertical',
                fontFamily: 'inherit',
                boxSizing: 'border-box',
              }}
            />
          </fieldset>

          {/* Generate Button */}
          <button
            onClick={handleGenerate}
            disabled={loading || selectedDocs.length === 0 || selectedTypes.length === 0}
            style={{
              padding: '12px 24px',
              background:
                selectedDocs.length === 0 || selectedTypes.length === 0 ? '#d1d5db' : '#6366f1',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              fontSize: 16,
              fontWeight: 600,
              cursor:
                selectedDocs.length === 0 || selectedTypes.length === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            {loading ? 'Starting...' : 'Generate Questions'}
          </button>
        </div>
      )}

      {/* ─── Step 2: Progress ──────────────────────────── */}
      {step === 'progress' && (
        <div
          style={{
            border: '1px solid #e5e7eb',
            borderRadius: 8,
            padding: 32,
            textAlign: 'center',
          }}
        >
          <h2 style={{ fontSize: 20, fontWeight: 600, marginBottom: 16 }}>
            Generating Questions...
          </h2>

          {/* Progress steps */}
          <div style={{ display: 'flex', justifyContent: 'center', gap: 32, marginBottom: 24 }}>
            {[
              { key: 'RETRIEVING', label: 'Retrieving content' },
              { key: 'GENERATING', label: 'Generating questions' },
              { key: 'REVIEW_READY', label: 'Ready for review' },
            ].map((s, i) => {
              const done =
                ['RETRIEVING', 'GENERATING', 'REVIEW_READY', 'COMPLETED'].indexOf(jobStatus) > i;
              const active =
                ['PENDING', 'RETRIEVING', 'GENERATING'][i + (i === 0 ? 0 : 0)] === jobStatus ||
                jobStatus === s.key;
              return (
                <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 18 }}>
                    {done ? '\u2705' : active ? '\u23F3' : '\u25CB'}
                  </span>
                  <span style={{ color: done ? '#22c55e' : active ? '#6366f1' : '#9ca3af' }}>
                    {s.label}
                  </span>
                </div>
              );
            })}
          </div>

          {jobStatus === 'FAILED' && job?.error && (
            <div
              style={{
                background: '#fef2f2',
                color: '#dc2626',
                padding: 16,
                borderRadius: 8,
                marginTop: 16,
              }}
            >
              <strong>Error:</strong> {job.error}
              <br />
              <button
                onClick={() => setStep('configure')}
                style={{
                  marginTop: 12,
                  padding: '8px 16px',
                  background: '#dc2626',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                }}
              >
                Try Again
              </button>
            </div>
          )}

          {jobStatus !== 'FAILED' && (
            <p style={{ color: '#9ca3af' }}>This may take 30-60 seconds.</p>
          )}
        </div>
      )}

      {/* ─── Step 3: Review ────────────────────────────── */}
      {step === 'review' && job && (
        <div>
          {/* Review summary bar */}
          <div
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              background: '#f9fafb',
              padding: '12px 16px',
              borderRadius: 8,
              marginBottom: 20,
            }}
          >
            <h2 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>
              Review Generated Questions ({questions.length})
            </h2>
            <div style={{ display: 'flex', gap: 16, fontSize: 14 }}>
              <span style={{ color: '#22c55e' }}>{approvedCount} Approved</span>
              <span style={{ color: '#ef4444' }}>{rejectedCount} Rejected</span>
              <span style={{ color: '#6b7280' }}>{pendingCount} Pending</span>
            </div>
          </div>

          {/* Question cards */}
          {questions.map((q, idx) => (
            <div
              key={idx}
              style={{
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                padding: 16,
                marginBottom: 16,
                opacity: q.reviewStatus === 'rejected' ? 0.5 : 1,
                borderLeft: `4px solid ${
                  q.reviewStatus === 'approved' || q.reviewStatus === 'edited'
                    ? '#22c55e'
                    : q.reviewStatus === 'rejected'
                      ? '#ef4444'
                      : '#d1d5db'
                }`,
              }}
            >
              {/* Question header */}
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: 12,
                }}
              >
                <span style={{ fontWeight: 600 }}>Question {idx + 1}</span>
                <div style={{ display: 'flex', gap: 8 }}>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: '#f3f4f6',
                      fontSize: 12,
                    }}
                  >
                    {TYPE_LABELS[q.type] || q.type}
                  </span>
                  <span
                    style={{
                      padding: '2px 8px',
                      borderRadius: 4,
                      background: DIFFICULTY_COLORS[q.difficulty] + '22',
                      color: DIFFICULTY_COLORS[q.difficulty],
                      fontSize: 12,
                      fontWeight: 600,
                    }}
                  >
                    {q.difficulty.charAt(0).toUpperCase() + q.difficulty.slice(1)}
                  </span>
                  {q.reviewStatus !== 'pending' && (
                    <span
                      style={{
                        padding: '2px 8px',
                        borderRadius: 4,
                        background: q.reviewStatus === 'rejected' ? '#fef2f2' : '#f0fdf4',
                        color: q.reviewStatus === 'rejected' ? '#ef4444' : '#22c55e',
                        fontSize: 12,
                        fontWeight: 600,
                        textTransform: 'capitalize',
                      }}
                    >
                      {q.reviewStatus}
                    </span>
                  )}
                </div>
              </div>

              {/* Edit mode */}
              {editingIndex === q.index ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                  <textarea
                    value={editForm.questionText || ''}
                    onChange={(e) =>
                      setEditForm((prev) => ({ ...prev, questionText: e.target.value }))
                    }
                    rows={3}
                    style={{
                      width: '100%',
                      padding: 8,
                      border: '1px solid #d1d5db',
                      borderRadius: 4,
                      fontFamily: 'inherit',
                      boxSizing: 'border-box',
                    }}
                  />
                  <div style={{ display: 'flex', gap: 8 }}>
                    <select
                      value={editForm.difficulty || q.difficulty}
                      onChange={(e) =>
                        setEditForm((prev) => ({
                          ...prev,
                          difficulty: e.target.value as any,
                        }))
                      }
                      style={{ padding: 6, borderRadius: 4, border: '1px solid #d1d5db' }}
                    >
                      <option value="easy">Easy</option>
                      <option value="medium">Medium</option>
                      <option value="hard">Hard</option>
                    </select>
                  </div>

                  {/* Edit MCQ options */}
                  {editForm.options && (
                    <div>
                      <strong style={{ fontSize: 13 }}>Options:</strong>
                      {editForm.options.map((opt, oi) => (
                        <div
                          key={oi}
                          style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 4 }}
                        >
                          <input
                            type="radio"
                            checked={opt.isCorrect}
                            onChange={() =>
                              setEditForm((prev) => ({
                                ...prev,
                                options: prev.options?.map((o, j) => ({
                                  ...o,
                                  isCorrect: j === oi,
                                })),
                              }))
                            }
                          />
                          <input
                            value={opt.text}
                            onChange={(e) =>
                              setEditForm((prev) => ({
                                ...prev,
                                options: prev.options?.map((o, j) =>
                                  j === oi ? { ...o, text: e.target.value } : o,
                                ),
                              }))
                            }
                            style={{
                              flex: 1,
                              padding: 6,
                              border: '1px solid #d1d5db',
                              borderRadius: 4,
                            }}
                          />
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 8 }}>
                    <button
                      onClick={() => handleReview(q.index, 'edit')}
                      disabled={reviewAction !== null}
                      style={{
                        padding: '6px 16px',
                        background: '#6366f1',
                        color: '#fff',
                        border: 'none',
                        borderRadius: 6,
                        cursor: 'pointer',
                      }}
                    >
                      Save & Approve
                    </button>
                    <button
                      onClick={() => {
                        setEditingIndex(null);
                        setEditForm({});
                      }}
                      style={{
                        padding: '6px 16px',
                        background: '#f3f4f6',
                        border: '1px solid #d1d5db',
                        borderRadius: 6,
                        cursor: 'pointer',
                      }}
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  {/* Question text */}
                  <p style={{ margin: '0 0 12px', lineHeight: 1.5 }}>{q.questionText}</p>

                  {/* MCQ options */}
                  {q.options && (
                    <div style={{ marginBottom: 12 }}>
                      {q.options.map((opt, oi) => (
                        <div
                          key={oi}
                          style={{
                            padding: '4px 8px',
                            background: opt.isCorrect ? '#f0fdf4' : 'transparent',
                            borderRadius: 4,
                            display: 'flex',
                            gap: 8,
                            alignItems: 'center',
                          }}
                        >
                          <span style={{ fontWeight: 600, width: 20 }}>{opt.label})</span>
                          <span>{opt.text}</span>
                          {opt.isCorrect && (
                            <span style={{ color: '#22c55e', fontSize: 12 }}>Correct</span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Answer key */}
                  <details style={{ marginBottom: 12 }}>
                    <summary
                      style={{ cursor: 'pointer', color: '#6366f1', fontSize: 13, fontWeight: 500 }}
                    >
                      Answer Key
                    </summary>
                    <pre
                      style={{
                        background: '#f9fafb',
                        padding: 12,
                        borderRadius: 4,
                        fontSize: 12,
                        overflow: 'auto',
                        whiteSpace: 'pre-wrap',
                      }}
                    >
                      {JSON.stringify(q.answerKey, null, 2)}
                    </pre>
                  </details>

                  {/* Difficulty justification */}
                  {q.difficultyJustification && (
                    <p
                      style={{
                        color: '#6b7280',
                        fontSize: 13,
                        margin: '0 0 8px',
                        fontStyle: 'italic',
                      }}
                    >
                      Difficulty: {q.difficultyJustification}
                    </p>
                  )}

                  {/* Knowledge tags */}
                  <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginBottom: 12 }}>
                    {q.knowledgeTags.map((tagId) => {
                      const kc = kcs.find((k) => k.id === tagId);
                      return (
                        <span
                          key={tagId}
                          style={{
                            padding: '2px 8px',
                            background: '#ede9fe',
                            color: '#6366f1',
                            borderRadius: 12,
                            fontSize: 12,
                          }}
                        >
                          {kc?.label || tagId.slice(0, 8)}
                        </span>
                      );
                    })}
                    {q.knowledgeTags.length === 0 && (
                      <span style={{ color: '#9ca3af', fontSize: 12 }}>No tags</span>
                    )}
                  </div>

                  {/* Action buttons */}
                  {q.reviewStatus === 'pending' && (
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => handleReview(q.index, 'approve')}
                        disabled={reviewAction !== null}
                        style={{
                          padding: '6px 14px',
                          background: '#22c55e',
                          color: '#fff',
                          border: 'none',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        Approve
                      </button>
                      <button
                        onClick={() => startEdit(q)}
                        style={{
                          padding: '6px 14px',
                          background: '#f3f4f6',
                          border: '1px solid #d1d5db',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleReview(q.index, 'reject')}
                        disabled={reviewAction !== null}
                        style={{
                          padding: '6px 14px',
                          background: '#fef2f2',
                          color: '#ef4444',
                          border: '1px solid #fca5a5',
                          borderRadius: 6,
                          cursor: 'pointer',
                          fontSize: 13,
                        }}
                      >
                        Reject
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          ))}

          {/* Bulk actions */}
          <div
            style={{
              display: 'flex',
              gap: 12,
              marginTop: 16,
              padding: 16,
              background: '#f9fafb',
              borderRadius: 8,
            }}
          >
            {pendingCount > 0 && (
              <button
                onClick={handleApproveAll}
                disabled={reviewAction !== null}
                style={{
                  padding: '10px 20px',
                  background: '#22c55e',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {reviewAction === 'approve-all'
                  ? 'Approving...'
                  : `Approve All Remaining (${pendingCount})`}
              </button>
            )}
            {rejectedCount > 0 && (
              <button
                onClick={handleRegenerate}
                disabled={reviewAction !== null}
                style={{
                  padding: '10px 20px',
                  background: '#6366f1',
                  color: '#fff',
                  border: 'none',
                  borderRadius: 6,
                  cursor: 'pointer',
                  fontWeight: 600,
                }}
              >
                {reviewAction === 'regenerate'
                  ? 'Regenerating...'
                  : `Regenerate Rejected (${rejectedCount})`}
              </button>
            )}
            <button
              onClick={() => navigate(-1)}
              style={{
                padding: '10px 20px',
                background: '#fff',
                border: '1px solid #d1d5db',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Done
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
