import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePageContext } from '../../contexts/PageContext';
import { apiFetch } from '../../lib/api';
import {
  connectSocket,
  joinStudentRoom,
  onGradeCompleted,
  disconnectSocket,
} from '../../lib/socket';
import { MDXRenderer } from '../../components/MDXRenderer';
import { DrawingCanvas, Stroke, strokesToPNGBlob } from '../../components/DrawingCanvas';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface Option {
  id: string;
  text: string;
  isCorrect?: boolean; // only present after graded
}

interface Question {
  id: string;
  type: 'text' | 'drawing' | 'mixed' | 'MCQ_SINGLE' | 'MCQ_MULTI' | 'STRUCTURED';
  prompt: string;
  maxScore: number;
  options: Option[] | null;
  explanation: unknown | null;
}

interface GradingResult {
  id: string;
  score: number;
  feedback: string;
  gradedBy: string;
  createdAt?: string;
}

interface Attempt {
  id: string;
  questionId: string;
  studentId: string;
  assessmentId: string;
  status: 'in_progress' | 'submitted' | 'grading' | 'graded';
  textResponse: string | null;
  strokesJson: Stroke[] | null;
  selectedOptionIds: string[] | null;
  workingStrokes: Stroke[] | null;
  workingBlobUrl: string | null;
  autoFeedback: string | null;
  currentScore: number | null;
  submittedAt: string | null;
  question: Question;
  gradingResults: GradingResult[];
  student: { id: string; name: string; email: string };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const AUTOSAVE_INTERVAL = 10000; // 10 seconds

/* ------------------------------------------------------------------ */
/*  Helper: upload a blob and return the URL                           */
/* ------------------------------------------------------------------ */

async function uploadBlob(blob: Blob, filename: string): Promise<string | undefined> {
  const formData = new FormData();
  formData.append('file', blob, filename);

  const result = await fetch(
    `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/blobs/upload`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${localStorage.getItem('token')}` },
      body: formData,
    },
  );

  if (result.ok) {
    const { url } = await result.json();
    return url as string;
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  Status badge                                                       */
/* ------------------------------------------------------------------ */

function StatusBadge({ status }: { status: Attempt['status'] }) {
  const style =
    status === 'in_progress'
      ? 'bg-yellow-100 text-yellow-800'
      : status === 'graded'
        ? 'bg-green-100 text-green-800'
        : 'bg-blue-100 text-blue-800';

  return (
    <span className={`text-xs px-2 py-1 rounded-full font-medium ${style}`}>
      {status.replace('_', ' ')}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function AttemptPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { setPageContext } = usePageContext();

  /* ---- core state ---- */
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- response state ---- */
  const [textResponse, setTextResponse] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [selectedOptionIds, setSelectedOptionIds] = useState<string[]>([]);
  const [workingStrokes, setWorkingStrokes] = useState<Stroke[]>([]);

  /* ---- UI state ---- */
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [gradingStatus, setGradingStatus] = useState<'idle' | 'pending' | 'completed'>('idle');
  const [, setGradeResult] = useState<GradingResult | null>(null);
  const [scratchOpen, setScratchOpen] = useState(false);

  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  /* ================================================================ */
  /*  Fetch attempt                                                    */
  /* ================================================================ */

  useEffect(() => {
    const fetchAttempt = async () => {
      if (!attemptId) return;

      try {
        const data = await apiFetch<Attempt>(`/attempts/${attemptId}`);
        setAttempt(data);
        setTextResponse(data.textResponse || '');
        setStrokes(data.strokesJson || []);
        setSelectedOptionIds(data.selectedOptionIds || []);
        setWorkingStrokes(data.workingStrokes || []);

        if (data.workingStrokes && data.workingStrokes.length > 0) {
          setScratchOpen(true);
        }

        if (data.status === 'graded' && data.gradingResults.length > 0) {
          setGradingStatus('completed');
          setGradeResult(data.gradingResults[0] ?? null);
        } else if (data.status === 'submitted' || data.status === 'grading') {
          setGradingStatus('pending');
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load attempt');
      } finally {
        setLoading(false);
      }
    };

    fetchAttempt();
  }, [attemptId]);

  /* ================================================================ */
  /*  Page Context for Floating Chatbot                                */
  /* ================================================================ */

  useEffect(() => {
    if (attempt) {
      setPageContext({
        pageType: 'quiz',
        courseId: null, // Assessment doesn't have course context directly
        contentId: attempt.assessmentId,
        contentTitle: `Question: ${attempt.question.prompt.slice(0, 50)}...`,
      });
    }
  }, [attempt?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  /* ================================================================ */
  /*  WebSocket for grade updates                                      */
  /* ================================================================ */

  useEffect(() => {
    if (!user || !attemptId) return;

    connectSocket();
    joinStudentRoom(user.id);

    const cleanup = onGradeCompleted((result) => {
      if (result.attemptId === attemptId) {
        setGradingStatus('completed');
        setGradeResult({
          id: result.attemptId,
          score: result.score,
          feedback: result.feedback,
          gradedBy: result.gradedBy,
        });
        setAttempt((prev) => (prev ? { ...prev, status: 'graded' } : null));
      }
    });

    return () => {
      cleanup();
      disconnectSocket();
    };
  }, [user, attemptId]);

  /* ================================================================ */
  /*  Save progress                                                    */
  /* ================================================================ */

  const saveProgress = useCallback(async () => {
    if (!attemptId || !attempt || attempt.status !== 'in_progress') return;

    setSaving(true);
    try {
      await apiFetch(`/attempts/${attemptId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          textResponse: textResponse || null,
          strokesJson: strokes.length > 0 ? strokes : null,
          selectedOptionIds: selectedOptionIds.length > 0 ? selectedOptionIds : null,
          workingStrokes: workingStrokes.length > 0 ? workingStrokes : null,
        }),
      });
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to save progress:', err);
    } finally {
      setSaving(false);
    }
  }, [attemptId, attempt, textResponse, strokes, selectedOptionIds, workingStrokes]);

  /* ================================================================ */
  /*  Autosave every 10s                                               */
  /* ================================================================ */

  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress') return;

    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    autosaveTimeoutRef.current = setTimeout(() => {
      saveProgress();
    }, AUTOSAVE_INTERVAL);

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [textResponse, strokes, selectedOptionIds, workingStrokes, attempt, saveProgress]);

  /* ================================================================ */
  /*  Submit attempt                                                   */
  /* ================================================================ */

  const handleSubmit = async () => {
    if (!attemptId || !attempt) return;

    setSubmitting(true);
    setError(null);

    try {
      // Upload drawing blob if strokes exist
      let drawingBlobUrl: string | undefined;
      if (strokes.length > 0) {
        const pngBlob = await strokesToPNGBlob(strokes, 800, 400);
        if (pngBlob) {
          drawingBlobUrl = await uploadBlob(pngBlob, `attempt-${attemptId}-drawing.png`);
        }
      }

      // Upload working canvas blob if working strokes exist
      let workingBlobUrl: string | undefined;
      if (workingStrokes.length > 0) {
        const workingBlob = await strokesToPNGBlob(workingStrokes, 800, 300);
        if (workingBlob) {
          workingBlobUrl = await uploadBlob(workingBlob, `attempt-${attemptId}-working.png`);
        }
      }

      const response = await apiFetch<Attempt>(`/attempts/${attemptId}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          textResponse: textResponse || null,
          selectedOptionIds: selectedOptionIds.length > 0 ? selectedOptionIds : null,
          strokesJson: strokes.length > 0 ? strokes : null,
          drawingBlobUrl,
          workingStrokes: workingStrokes.length > 0 ? workingStrokes : null,
          workingBlobUrl,
        }),
      });

      // Update local state from server response (contains autoFeedback / currentScore for MCQ)
      if (response && typeof response === 'object' && 'id' in response) {
        setAttempt(response);
        if (response.status === 'graded' && response.gradingResults.length > 0) {
          setGradingStatus('completed');
          setGradeResult(response.gradingResults[0] ?? null);
        } else {
          setGradingStatus('pending');
        }
      } else {
        setAttempt((prev) => (prev ? { ...prev, status: 'submitted' } : null));
        setGradingStatus('pending');
      }

      // For MCQ types show auto-grade result immediately if present
      const isMCQ =
        attempt.question.type === 'MCQ_SINGLE' || attempt.question.type === 'MCQ_MULTI';
      if (isMCQ && response && 'autoFeedback' in response) {
        setAttempt((prev) =>
          prev
            ? {
                ...prev,
                autoFeedback: (response as Attempt).autoFeedback,
                currentScore: (response as Attempt).currentScore,
                status: (response as Attempt).status,
              }
            : null,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit attempt');
    } finally {
      setSubmitting(false);
    }
  };

  /* ================================================================ */
  /*  MCQ option handlers                                              */
  /* ================================================================ */

  const handleSingleSelect = (optionId: string) => {
    setSelectedOptionIds([optionId]);
  };

  const handleMultiSelect = (optionId: string) => {
    setSelectedOptionIds((prev) =>
      prev.includes(optionId) ? prev.filter((id) => id !== optionId) : [...prev, optionId],
    );
  };

  /* ================================================================ */
  /*  Render guards                                                    */
  /* ================================================================ */

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="text-gray-500">Loading attempt...</div>
      </div>
    );
  }

  if (error && !attempt) {
    return (
      <div className="p-4 bg-red-50 text-red-700 rounded-lg">
        {error}
        <button onClick={() => navigate('/student/assessments')} className="ml-4 underline">
          Back to Assessments
        </button>
      </div>
    );
  }

  if (!attempt) {
    return <div>Attempt not found</div>;
  }

  /* ================================================================ */
  /*  Derived helpers                                                   */
  /* ================================================================ */

  const { question } = attempt;
  const isEditable = attempt.status === 'in_progress';
  const isGraded = attempt.status === 'graded';
  const isMCQ = question.type === 'MCQ_SINGLE' || question.type === 'MCQ_MULTI';
  const showTextInput =
    question.type === 'text' ||
    question.type === 'mixed' ||
    question.type === 'STRUCTURED';
  const showDrawing = question.type === 'drawing' || question.type === 'mixed';

  /* ================================================================ */
  /*  Sub-renders                                                      */
  /* ================================================================ */

  const renderMCQOptions = () => {
    if (!question.options) return null;

    return (
      <div className="space-y-3">
        {question.options.map((option) => {
          const isSelected = selectedOptionIds.includes(option.id);
          const isSingle = question.type === 'MCQ_SINGLE';

          // Review-mode indicators
          let optionStyle = 'border-gray-200 bg-white';
          let indicator: React.ReactNode = null;

          if (isGraded && option.isCorrect !== undefined) {
            if (option.isCorrect && isSelected) {
              optionStyle = 'border-green-400 bg-green-50';
              indicator = <span className="text-green-600 font-bold ml-2">&#10003;</span>;
            } else if (option.isCorrect && !isSelected) {
              optionStyle = 'border-green-300 bg-green-50';
              indicator = <span className="text-green-600 font-bold ml-2">&#10003;</span>;
            } else if (!option.isCorrect && isSelected) {
              optionStyle = 'border-red-400 bg-red-50';
              indicator = <span className="text-red-600 font-bold ml-2">&#10007;</span>;
            }
          } else if (isSelected) {
            optionStyle = 'border-blue-400 bg-blue-50';
          }

          return (
            <label
              key={option.id}
              className={`flex items-center gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${optionStyle} ${
                isEditable ? 'hover:border-blue-300' : 'cursor-default'
              }`}
            >
              {isSingle ? (
                <input
                  type="radio"
                  name={`mcq-${question.id}`}
                  checked={isSelected}
                  onChange={() => handleSingleSelect(option.id)}
                  disabled={!isEditable}
                  className="w-4 h-4 text-blue-600 focus:ring-blue-500"
                />
              ) : (
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => handleMultiSelect(option.id)}
                  disabled={!isEditable}
                  className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                />
              )}
              <span className="flex-1 text-gray-800">{option.text}</span>
              {indicator}
            </label>
          );
        })}
      </div>
    );
  };

  const renderAutoGrade = () => {
    if (!isMCQ) return null;
    if (attempt.autoFeedback === null && attempt.currentScore === null) return null;

    return (
      <div className="mb-6 p-4 bg-indigo-50 border border-indigo-200 rounded-lg">
        <h3 className="font-medium text-indigo-800 mb-2">Auto-Grade Result</h3>
        {attempt.currentScore !== null && (
          <div className="flex items-center gap-4 mb-2">
            <span className="text-2xl font-bold text-indigo-700">
              {attempt.currentScore}/{question.maxScore}
            </span>
            <span className="text-indigo-600">
              ({Math.round((attempt.currentScore / question.maxScore) * 100)}%)
            </span>
          </div>
        )}
        {attempt.autoFeedback && <p className="text-indigo-700">{attempt.autoFeedback}</p>}
      </div>
    );
  };

  const renderGradingResults = () => {
    if (!isGraded || attempt.gradingResults.length === 0) return null;

    return (
      <div className="mb-6 space-y-4">
        {attempt.gradingResults.map((gr, idx) => (
          <div key={gr.id} className="p-4 bg-green-50 border border-green-200 rounded-lg">
            <h3 className="font-medium text-green-800 mb-2">
              {attempt.gradingResults.length > 1 ? `Grading Result #${idx + 1}` : 'Grading Result'}
            </h3>
            <div className="flex items-center gap-4 mb-2">
              <span className="text-2xl font-bold text-green-700">
                {gr.score}/{question.maxScore}
              </span>
              <span className="text-green-600">
                ({Math.round((gr.score / question.maxScore) * 100)}%)
              </span>
            </div>
            <p className="text-green-700">{gr.feedback}</p>
            <p className="text-sm text-green-600 mt-2">
              Graded by: {gr.gradedBy}
              {gr.createdAt && ` on ${new Date(gr.createdAt).toLocaleString()}`}
            </p>
          </div>
        ))}
      </div>
    );
  };

  const renderExplanation = () => {
    if (!isGraded || !question.explanation) return null;

    const explanationText =
      typeof question.explanation === 'string'
        ? question.explanation
        : JSON.stringify(question.explanation, null, 2);

    return (
      <div className="mb-6 p-4 bg-amber-50 border border-amber-200 rounded-lg">
        <h3 className="font-medium text-amber-800 mb-2">Explanation</h3>
        <MDXRenderer content={explanationText} />
      </div>
    );
  };

  const renderScratchWork = () => {
    const hasWorkingStrokes = workingStrokes.length > 0 || (attempt.workingStrokes && attempt.workingStrokes.length > 0);
    // In review mode, only show if there are working strokes
    if (!isEditable && !hasWorkingStrokes) return null;

    return (
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 mb-6">
        <button
          type="button"
          onClick={() => setScratchOpen((o) => !o)}
          className="w-full flex items-center justify-between px-6 py-4 text-left"
        >
          <h2 className="text-lg font-semibold text-gray-900">Scratch Work</h2>
          <svg
            className={`w-5 h-5 text-gray-500 transition-transform ${scratchOpen ? 'rotate-180' : ''}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>

        {scratchOpen && (
          <div className="px-6 pb-6">
            <p className="text-sm text-gray-500 mb-3">
              Use this canvas for rough work. It is saved automatically but not graded.
            </p>
            <DrawingCanvas
              width={800}
              height={300}
              initialStrokes={workingStrokes}
              onStrokesChange={isEditable ? setWorkingStrokes : undefined}
              readOnly={!isEditable}
            />
          </div>
        )}
      </div>
    );
  };

  /* ================================================================ */
  /*  Main render                                                      */
  /* ================================================================ */

  return (
    <div className="max-w-4xl mx-auto">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <button
          onClick={() => navigate('/student/assessments')}
          className="text-gray-600 hover:text-gray-900"
        >
          &larr; Back to Assessments
        </button>
        <div className="flex items-center gap-4">
          {isEditable && lastSaved && (
            <span className="text-sm text-gray-500">
              {saving ? 'Saving...' : `Last saved: ${lastSaved.toLocaleTimeString()}`}
            </span>
          )}
          <StatusBadge status={attempt.status} />
        </div>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {/* Grading pending banner */}
      {gradingStatus === 'pending' && !isMCQ && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent" />
            <div>
              <p className="font-medium text-blue-800">Grading in progress...</p>
              <p className="text-sm text-blue-600">
                Your submission is being graded. Results will appear here automatically.
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Auto-grade display (MCQ) */}
      {renderAutoGrade()}

      {/* Grading results (review mode) */}
      {renderGradingResults()}

      {/* Explanation (review mode) */}
      {renderExplanation()}

      {/* Question prompt */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Question</h2>
        <MDXRenderer content={question.prompt} />
        <div className="mt-4 text-sm text-gray-500">Max score: {question.maxScore} points</div>
      </div>

      {/* Response area */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Response</h2>

        {/* MCQ options */}
        {isMCQ && renderMCQOptions()}

        {/* Text input */}
        {showTextInput && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">
              {question.type === 'STRUCTURED' ? 'Structured Response' : 'Text Answer'}
            </label>
            <textarea
              value={textResponse}
              onChange={(e) => setTextResponse(e.target.value)}
              disabled={!isEditable}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 disabled:bg-gray-100 disabled:cursor-not-allowed"
              rows={6}
              placeholder="Type your answer here..."
            />
          </div>
        )}

        {/* Drawing canvas */}
        {showDrawing && (
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Drawing</label>
            <DrawingCanvas
              width={800}
              height={400}
              initialStrokes={strokes}
              onStrokesChange={isEditable ? setStrokes : undefined}
              readOnly={!isEditable}
            />
          </div>
        )}
      </div>

      {/* Scratch Work panel -- available for ALL question types */}
      {renderScratchWork()}

      {/* Actions */}
      {isEditable && (
        <div className="flex items-center justify-end gap-4 mb-8">
          <button
            onClick={saveProgress}
            disabled={saving}
            className="px-4 py-2 text-gray-700 bg-gray-100 rounded-lg hover:bg-gray-200 disabled:opacity-50"
          >
            {saving ? 'Saving...' : 'Save Progress'}
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="px-6 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {submitting ? 'Submitting...' : 'Submit Answer'}
          </button>
        </div>
      )}
    </div>
  );
}
