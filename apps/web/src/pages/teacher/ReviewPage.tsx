import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

interface GradingResult {
  id: string;
  score: number;
  feedback: string;
  gradedBy: string;
}

interface Question {
  id: string;
  prompt: string;
  maxScore: number;
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
  submittedAt: string | null;
  question: Question;
  student: User;
  gradingResults: GradingResult[];
}

export function ReviewPage() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [selectedAttempt, setSelectedAttempt] = useState<Attempt | null>(null);
  const [score, setScore] = useState(0);
  const [feedback, setFeedback] = useState('');
  const [grading, setGrading] = useState(false);

  const fetchAttempts = async () => {
    try {
      const data = await apiFetch<Attempt[]>('/api/attempts/review');
      setAttempts(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load attempts');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchAttempts();
  }, []);

  const handleGrade = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAttempt) return;

    setGrading(true);
    setError(null);

    try {
      await apiFetch(`/api/attempts/${selectedAttempt.id}/grade`, {
        method: 'POST',
        body: JSON.stringify({
          score,
          feedback,
        }),
      });
      setSelectedAttempt(null);
      setScore(0);
      setFeedback('');
      fetchAttempts();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to grade attempt');
    } finally {
      setGrading(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading attempts for review...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Pending Reviews</h2>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {selectedAttempt && (
        <div className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="flex items-center justify-between mb-4">
            <h3 className="text-lg font-semibold text-gray-900">Grade Submission</h3>
            <button
              onClick={() => setSelectedAttempt(null)}
              className="text-gray-500 hover:text-gray-700"
            >
              Close
            </button>
          </div>

          <div className="mb-4 p-3 bg-gray-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">Question:</p>
            <pre className="text-sm text-gray-700 whitespace-pre-wrap">
              {selectedAttempt.question.prompt}
            </pre>
          </div>

          <div className="mb-4 p-3 bg-blue-50 rounded-lg">
            <p className="text-sm text-gray-500 mb-1">
              Student Response ({selectedAttempt.student.name}):
            </p>
            {selectedAttempt.textResponse ? (
              <p className="text-gray-900">{selectedAttempt.textResponse}</p>
            ) : (
              <p className="text-gray-500 italic">No text response</p>
            )}
            {selectedAttempt.drawingBlobUrl && (
              <div className="mt-2">
                <p className="text-sm text-gray-500 mb-1">Drawing:</p>
                <img
                  src={selectedAttempt.drawingBlobUrl}
                  alt="Student drawing"
                  className="max-w-full h-auto border rounded"
                />
              </div>
            )}
          </div>

          <form onSubmit={handleGrade} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Score (max: {selectedAttempt.question.maxScore})
              </label>
              <input
                type="number"
                value={score}
                onChange={(e) => setScore(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min={0}
                max={selectedAttempt.question.maxScore}
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

      <div className="space-y-4">
        {attempts.length === 0 ? (
          <div className="text-gray-500 text-center py-8">No attempts pending review</div>
        ) : (
          attempts.map((attempt) => (
            <div
              key={attempt.id}
              className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
            >
              <div className="flex items-start justify-between">
                <div>
                  <p className="font-medium text-gray-900">{attempt.student.name}</p>
                  <p className="text-sm text-gray-500">
                    Submitted:{' '}
                    {attempt.submittedAt ? new Date(attempt.submittedAt).toLocaleString() : 'N/A'}
                  </p>
                  <p className="text-sm text-gray-600 mt-1">
                    {attempt.question.prompt.substring(0, 80)}...
                  </p>
                </div>
                <button
                  onClick={() => {
                    setSelectedAttempt(attempt);
                    setScore(0);
                    setFeedback('');
                  }}
                  className="px-3 py-1 bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                >
                  Review
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
