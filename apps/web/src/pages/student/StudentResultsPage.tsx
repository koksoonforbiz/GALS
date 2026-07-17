import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';
import { formatDateTimeSGT } from '../../lib/formatDateTime';

interface Grader {
  id: string;
  name: string;
}

interface GradingResult {
  id: string;
  score: number;
  feedback: string;
  gradedBy: string;
  grader: Grader | null;
  createdAt: string;
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
  currentScore: number | null;
  submittedAt: string | null;
  question: Question;
  gradingResults: GradingResult[];
}

export function StudentResultsPage() {
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    const fetchAttempts = async () => {
      try {
        const data = await apiFetch<Attempt[]>('/attempts/my');
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
            const latestResult = attempt.gradingResults[0] ?? null;
            const currentScore = attempt.currentScore ?? latestResult?.score ?? null;
            const percentage =
              currentScore !== null
                ? Math.round((currentScore / attempt.question.maxScore) * 100)
                : 0;
            const isExpanded = expandedId === attempt.id;
            const hasMultipleGrades = attempt.gradingResults.length > 1;

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

                    {latestResult && (
                      <div className="mt-3 p-3 bg-blue-50 rounded-lg">
                        <div className="flex items-center gap-2 mb-1">
                          <p className="text-sm text-gray-500">Latest Feedback:</p>
                          <span className="inline-block px-2 py-0.5 bg-yellow-200 text-yellow-800 rounded text-xs font-medium">
                            Latest
                          </span>
                        </div>
                        <p className="text-gray-900">{latestResult.feedback}</p>
                        <p className="text-xs text-gray-500 mt-2">
                          Graded by:{' '}
                          {latestResult.gradedBy === 'auto'
                            ? 'Auto-grader'
                            : (latestResult.grader?.name ?? 'Teacher')}{' '}
                          | {formatDateTimeSGT(latestResult.createdAt)}
                        </p>
                      </div>
                    )}

                    {/* Grading History Toggle */}
                    {hasMultipleGrades && (
                      <div className="mt-3">
                        <button
                          onClick={() => setExpandedId(isExpanded ? null : attempt.id)}
                          className="text-sm text-blue-600 hover:text-blue-800"
                        >
                          {isExpanded ? 'Hide' : 'Show'} grading history (
                          {attempt.gradingResults.length} grades)
                        </button>

                        {isExpanded && (
                          <div className="mt-2 overflow-x-auto">
                            <table className="w-full text-sm border border-gray-200 rounded-lg">
                              <thead>
                                <tr className="bg-gray-50">
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-600">
                                    #
                                  </th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-600">
                                    Score
                                  </th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-600">
                                    Feedback
                                  </th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-600">
                                    Graded By
                                  </th>
                                  <th className="text-left px-3 py-1.5 font-medium text-gray-600">
                                    Date
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {attempt.gradingResults.map((result, index) => (
                                  <tr
                                    key={result.id}
                                    className={`border-t border-gray-100 ${
                                      index === 0 ? 'bg-yellow-50' : ''
                                    }`}
                                  >
                                    <td className="px-3 py-1.5 text-gray-500">
                                      {index === 0 ? (
                                        <span className="inline-block px-1.5 py-0.5 bg-yellow-200 text-yellow-800 rounded text-xs font-medium">
                                          Latest
                                        </span>
                                      ) : (
                                        attempt.gradingResults.length - index
                                      )}
                                    </td>
                                    <td className="px-3 py-1.5 font-medium">
                                      {result.score} / {attempt.question.maxScore}
                                    </td>
                                    <td className="px-3 py-1.5 text-gray-700 max-w-xs truncate">
                                      {result.feedback}
                                    </td>
                                    <td className="px-3 py-1.5 text-gray-600">
                                      {result.gradedBy === 'auto'
                                        ? 'Auto-grader'
                                        : (result.grader?.name ?? 'Teacher')}
                                    </td>
                                    <td className="px-3 py-1.5 text-gray-500">
                                      {formatDateTimeSGT(result.createdAt)}
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    )}
                  </div>

                  <div className="ml-4 text-right">
                    {currentScore !== null ? (
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
                          {currentScore}/{attempt.question.maxScore}
                        </div>
                        <div className="text-sm text-gray-500">{percentage}%</div>
                        {hasMultipleGrades && (
                          <div className="text-xs text-gray-400 mt-1">
                            {attempt.gradingResults.length} grades
                          </div>
                        )}
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
