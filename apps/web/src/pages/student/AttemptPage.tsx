import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/api';
import {
  connectSocket,
  joinStudentRoom,
  onGradeCompleted,
  disconnectSocket,
} from '../../lib/socket';
import { MDXRenderer } from '../../components/MDXRenderer';
import { DrawingCanvas, Stroke, strokesToPNGBlob } from '../../components/DrawingCanvas';

interface Question {
  id: string;
  type: 'text' | 'drawing' | 'mixed';
  prompt: string;
  maxScore: number;
}

interface GradingResult {
  id: string;
  score: number;
  feedback: string;
  gradedBy: string;
}

interface Attempt {
  id: string;
  questionId: string;
  studentId: string;
  assessmentId: string;
  status: 'in_progress' | 'submitted' | 'grading' | 'graded';
  textResponse: string | null;
  strokesJson: Stroke[] | null;
  submittedAt: string | null;
  question: Question;
  gradingResults: GradingResult[];
}

const AUTOSAVE_INTERVAL = 10000; // 10 seconds

export function AttemptPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();

  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [textResponse, setTextResponse] = useState('');
  const [strokes, setStrokes] = useState<Stroke[]>([]);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [lastSaved, setLastSaved] = useState<Date | null>(null);
  const [gradingStatus, setGradingStatus] = useState<'idle' | 'pending' | 'completed'>('idle');
  const [gradeResult, setGradeResult] = useState<GradingResult | null>(null);

  const autosaveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Fetch attempt data
  useEffect(() => {
    const fetchAttempt = async () => {
      if (!attemptId) return;

      try {
        const data = await apiFetch<Attempt>(`/api/attempts/${attemptId}`);
        setAttempt(data);
        setTextResponse(data.textResponse || '');
        setStrokes(data.strokesJson || []);

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

  // Setup WebSocket connection for grade updates
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
        setAttempt((prev) =>
          prev
            ? {
                ...prev,
                status: 'graded',
              }
            : null,
        );
      }
    });

    return () => {
      cleanup();
      disconnectSocket();
    };
  }, [user, attemptId]);

  // Save progress function
  const saveProgress = useCallback(async () => {
    if (!attemptId || !attempt || attempt.status !== 'in_progress') return;

    setSaving(true);
    try {
      await apiFetch(`/api/attempts/${attemptId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          textResponse: textResponse || null,
          strokesJson: strokes.length > 0 ? strokes : null,
        }),
      });
      setLastSaved(new Date());
    } catch (err) {
      console.error('Failed to save progress:', err);
    } finally {
      setSaving(false);
    }
  }, [attemptId, attempt, textResponse, strokes]);

  // Autosave effect
  useEffect(() => {
    if (!attempt || attempt.status !== 'in_progress') return;

    // Clear previous timeout
    if (autosaveTimeoutRef.current) {
      clearTimeout(autosaveTimeoutRef.current);
    }

    // Set new timeout for autosave
    autosaveTimeoutRef.current = setTimeout(() => {
      saveProgress();
    }, AUTOSAVE_INTERVAL);

    return () => {
      if (autosaveTimeoutRef.current) {
        clearTimeout(autosaveTimeoutRef.current);
      }
    };
  }, [textResponse, strokes, attempt, saveProgress]);

  // Submit attempt
  const handleSubmit = async () => {
    if (!attemptId || !attempt) return;

    setSubmitting(true);
    setError(null);

    try {
      // Generate PNG snapshot if there are strokes
      let drawingBlobUrl: string | undefined;
      if (strokes.length > 0) {
        const pngBlob = await strokesToPNGBlob(strokes, 800, 400);
        if (pngBlob) {
          // Upload to blob storage via API
          const formData = new FormData();
          formData.append('file', pngBlob, `attempt-${attemptId}-drawing.png`);

          const uploadResult = await fetch(
            `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/blobs/upload`,
            {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${localStorage.getItem('token')}`,
              },
              body: formData,
            },
          );

          if (uploadResult.ok) {
            const { url } = await uploadResult.json();
            drawingBlobUrl = url;
          }
        }
      }

      // Submit the attempt
      await apiFetch(`/api/attempts/${attemptId}/submit`, {
        method: 'POST',
        body: JSON.stringify({
          textResponse: textResponse || null,
          strokesJson: strokes.length > 0 ? strokes : null,
          drawingBlobUrl,
        }),
      });

      setAttempt((prev) =>
        prev
          ? {
              ...prev,
              status: 'submitted',
            }
          : null,
      );
      setGradingStatus('pending');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit attempt');
    } finally {
      setSubmitting(false);
    }
  };

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

  const isEditable = attempt.status === 'in_progress';
  const showTextInput = attempt.question.type === 'text' || attempt.question.type === 'mixed';
  const showDrawing = attempt.question.type === 'drawing' || attempt.question.type === 'mixed';

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
          <span
            className={`text-xs px-2 py-1 rounded-full font-medium ${
              attempt.status === 'in_progress'
                ? 'bg-yellow-100 text-yellow-800'
                : attempt.status === 'graded'
                  ? 'bg-green-100 text-green-800'
                  : 'bg-blue-100 text-blue-800'
            }`}
          >
            {attempt.status.replace('_', ' ')}
          </span>
        </div>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {/* Grading status */}
      {gradingStatus === 'pending' && (
        <div className="mb-6 p-4 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-3">
            <div className="animate-spin rounded-full h-5 w-5 border-2 border-blue-600 border-t-transparent"></div>
            <div>
              <p className="font-medium text-blue-800">Grading in progress...</p>
              <p className="text-sm text-blue-600">
                Your submission is being graded. Results will appear here automatically.
              </p>
            </div>
          </div>
        </div>
      )}

      {gradingStatus === 'completed' && gradeResult && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg">
          <h3 className="font-medium text-green-800 mb-2">Grading Complete!</h3>
          <div className="flex items-center gap-4 mb-2">
            <span className="text-2xl font-bold text-green-700">
              {gradeResult.score}/{attempt.question.maxScore}
            </span>
            <span className="text-green-600">
              ({Math.round((gradeResult.score / attempt.question.maxScore) * 100)}%)
            </span>
          </div>
          <p className="text-green-700">{gradeResult.feedback}</p>
          <p className="text-sm text-green-600 mt-2">Graded by: {gradeResult.gradedBy}</p>
        </div>
      )}

      {/* Question */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Question</h2>
        <MDXRenderer content={attempt.question.prompt} />
        <div className="mt-4 text-sm text-gray-500">
          Max score: {attempt.question.maxScore} points
        </div>
      </div>

      {/* Response area */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-6 mb-6">
        <h2 className="text-lg font-semibold text-gray-900 mb-4">Your Response</h2>

        {showTextInput && (
          <div className="mb-6">
            <label className="block text-sm font-medium text-gray-700 mb-2">Text Answer</label>
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

      {/* Actions */}
      {isEditable && (
        <div className="flex items-center justify-end gap-4">
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
