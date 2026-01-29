import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

interface Grader {
  id: string;
  name: string;
}

interface GradingResult {
  id: string;
  score: number;
  feedback: string;
  gradedBy: string;
  graderId: string | null;
  grader: Grader | null;
  createdAt: string;
}

interface Question {
  id: string;
  prompt: string;
  maxScore: number;
  type: string;
  topic: {
    id: string;
    title: string;
    course: {
      id: string;
      title: string;
      teacherId: string;
    };
  };
}

interface User {
  id: string;
  name: string;
  email: string;
}

interface Attempt {
  id: string;
  questionId: string;
  studentId: string;
  status: string;
  textResponse: string | null;
  drawingBlobUrl: string | null;
  currentScore: number | null;
  submittedAt: string | null;
  createdAt: string;
  question: Question;
  student: User;
  gradingResults: GradingResult[];
}

export function AttemptDetailPage() {
  const { attemptId } = useParams<{ attemptId: string }>();
  const navigate = useNavigate();
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [grading, setGrading] = useState(false);

  const fetchAttempt = async () => {
    try {
      const data = await apiFetch<Attempt>(`/api/attempts/${attemptId}`);
      setAttempt(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attempt');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttempt();
  }, [attemptId]);

  const handleGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!attempt) return;

    setGrading(true);
    setError(null);

    try {
      await apiFetch(`/api/attempts/${attempt.id}/grade`, {
        method: 'POST',
        body: JSON.stringify({ score, feedback }),
      });
      setScore(0);
      setFeedback('');
      fetchAttempt();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit grade');
    } finally {
      setGrading(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading attempt details...</div>;
  }

  if (!attempt) {
    return <div className="text-red-600">Attempt not found.</div>;
  }

  return (
    <div className="max-w-4xl">
      <button
        onClick={() => navigate('/teacher/review')}
        className="mb-4 text-blue-600 hover:text-blue-800 text-sm"
      >
        &larr; Back to Reviews
      </button>

      <h2 className="text-2xl font-bold text-gray-900 mb-2">Attempt Details</h2>
      <p className="text-sm text-gray-500 mb-6">
        {attempt.student.name} ({attempt.student.email}) &middot;{' '}
        {attempt.question.topic.course.title} &middot; Status:{' '}
        <span className="font-medium">{attempt.status}</span>
      </p>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {/* Current Score Banner */}
      {attempt.currentScore !== null && attempt.currentScore !== undefined && (
        <div className="mb-6 p-4 bg-green-50 border border-green-200 rounded-lg flex items-center justify-between">
          <div>
            <p className="text-sm text-green-700 font-medium">Current Score</p>
            <p className="text-2xl font-bold text-green-800">
              {attempt.currentScore} / {attempt.question.maxScore}
            </p>
          </div>
          <div className="text-sm text-green-600">
            {Math.round((attempt.currentScore / attempt.question.maxScore) * 100)}%
          </div>
        </div>
      )}

      {/* Question */}
      <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
        <p className="text-sm font-medium text-gray-500 mb-2">Question</p>
        <pre className="text-sm text-gray-800 whitespace-pre-wrap">{attempt.question.prompt}</pre>
        <p className="text-xs text-gray-400 mt-2">
          Type: {attempt.question.type} &middot; Max score: {attempt.question.maxScore}
        </p>
      </div>

      {/* Student Response */}
      <div className="mb-6 p-4 bg-blue-50 rounded-lg border border-blue-200">
        <p className="text-sm font-medium text-gray-500 mb-2">Student Response</p>
        {attempt.textResponse ? (
          <p className="text-gray-900 whitespace-pre-wrap">{attempt.textResponse}</p>
        ) : (
          <p className="text-gray-400 italic">No text response</p>
        )}
        {attempt.drawingBlobUrl && (
          <div className="mt-3">
            <p className="text-sm text-gray-500 mb-1">Drawing:</p>
            <img
              src={attempt.drawingBlobUrl}
              alt="Student drawing"
              className="max-w-full h-auto border rounded bg-white"
            />
          </div>
        )}
      </div>

      {/* Grading History */}
      <div className="mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-3">Grading History</h3>
        {attempt.gradingResults.length === 0 ? (
          <p className="text-gray-500 text-sm">No grades recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-200 rounded-lg">
              <thead>
                <tr className="bg-gray-50">
                  <th className="text-left px-4 py-2 font-medium text-gray-600">#</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Score</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Feedback</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Graded By</th>
                  <th className="text-left px-4 py-2 font-medium text-gray-600">Date</th>
                </tr>
              </thead>
              <tbody>
                {attempt.gradingResults.map((result, index) => (
                  <tr
                    key={result.id}
                    className={`border-t border-gray-100 ${index === 0 ? 'bg-yellow-50' : ''}`}
                  >
                    <td className="px-4 py-2 text-gray-500">
                      {index === 0 ? (
                        <span className="inline-block px-2 py-0.5 bg-yellow-200 text-yellow-800 rounded text-xs font-medium">
                          Latest
                        </span>
                      ) : (
                        attempt.gradingResults.length - index
                      )}
                    </td>
                    <td className="px-4 py-2 font-medium">
                      {result.score} / {attempt.question.maxScore}
                    </td>
                    <td className="px-4 py-2 text-gray-700 max-w-xs truncate">{result.feedback}</td>
                    <td className="px-4 py-2 text-gray-600">
                      {result.gradedBy === 'auto'
                        ? 'Auto-grader'
                        : (result.grader?.name ?? 'Unknown')}
                    </td>
                    <td className="px-4 py-2 text-gray-500">
                      {new Date(result.createdAt).toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Grade Form */}
      {(attempt.status === 'submitted' ||
        attempt.status === 'grading' ||
        attempt.status === 'graded') && (
        <div className="p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">
            {attempt.gradingResults.length > 0 ? 'Add New Grade' : 'Enter Grade'}
          </h3>
          <form onSubmit={handleGrade} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Score (max: {attempt.question.maxScore})
              </label>
              <input
                type="number"
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min={0}
                max={attempt.question.maxScore}
                step="any"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Feedback</label>
              <textarea
                value={feedback}
                onChange={(e) => setFeedback(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={3}
                required
              />
            </div>
            <button
              type="submit"
              disabled={grading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {grading ? 'Submitting...' : 'Submit Grade'}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
