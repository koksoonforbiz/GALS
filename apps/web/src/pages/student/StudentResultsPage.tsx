import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

interface GradingResult {
  id: string;
  score: number;
  feedback: string;
  gradedBy: string;
  gradedAt: string;
}

interface Question {
  id: string;
  prompt: string;
  maxScore: number;
}

interface Attempt {
  id: string;
  status: string;
  textResponse: string | null;
  submittedAt: string | null;
  question: Question;
  gradingResults: GradingResult[];
}

export function StudentResultsPage() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchAttempts = async () => {
      try {
        const data = await apiFetch<Attempt[]>('/api/attempts/my');
        // Filter to only show graded attempts
        setAttempts(data.filter((a) => a.status === 'graded'));
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load results');
      } finally {
        setLoading(false);
      }
    };
    fetchAttempts();
  }, []);

  if (loading) {
    return <div className="text-gray-500">Loading results...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Your Results</h2>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      <div className="space-y-4">
        {attempts.length === 0 ? (
          <div className="text-gray-500 text-center py-8">No graded results yet.</div>
        ) : (
          attempts.map((attempt) => {
            const result = attempt.gradingResults[0];
            const percentage = result
              ? Math.round((result.score / attempt.question.maxScore) * 100)
              : 0;

            return (
              <div
                key={attempt.id}
                className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <pre className="text-sm text-gray-700 whitespace-pre-wrap mb-2">
                      {attempt.question.prompt.substring(0, 150)}
                      {attempt.question.prompt.length > 150 ? '...' : ''}
                    </pre>

                    <div className="mt-3 p-3 bg-gray-50 rounded-lg">
                      <p className="text-sm text-gray-500 mb-1">Your answer:</p>
                      <p className="text-gray-900">{attempt.textResponse || 'No text response'}</p>
                    </div>

                    {result && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                        <p className="text-sm text-gray-500 mb-1">Feedback:</p>
                        <p className="text-gray-900">{result.feedback}</p>
                        <p className="text-xs text-gray-500 mt-2">
                          Graded by: {result.gradedBy} |{' '}
                          {new Date(result.gradedAt).toLocaleString()}
                        </p>
                      </div>
                    )}
                  </div>

                  <div className="ml-4 text-right">
                    {result ? (
                      <>
                        <div
                          className={`text-2xl font-bold ${
                            percentage >= 70
                              ? 'text-green-600'
                              : percentage >= 50
                                ? 'text-yellow-600'
                                : 'text-red-600'
                          }`}
                        >
                          {result.score}/{attempt.question.maxScore}
                        </div>
                        <div className="text-sm text-gray-500">{percentage}%</div>
                      </>
                    ) : (
                      <div className="text-gray-500">Pending</div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
