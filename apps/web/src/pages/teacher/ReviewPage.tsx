import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
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
  currentScore: number | null;
  submittedAt: string | null;
  question: Question;
  student: User;
  gradingResults: GradingResult[];
}

export function ReviewPage() {
  const navigate = useNavigate();
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<'all' | 'pending' | 'graded'>('all');

  const fetchAttempts = async () => {
    try {
      const data = await apiFetch<Attempt[]>('/attempts/review');
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

  const filteredAttempts = attempts.filter((a) => {
    if (filter === 'pending') return a.status === 'submitted' || a.status === 'grading';
    if (filter === 'graded') return a.status === 'graded';
    return true;
  });

  const pendingCount = attempts.filter(
    (a) => a.status === 'submitted' || a.status === 'grading',
  ).length;
  const gradedCount = attempts.filter((a) => a.status === 'graded').length;

  if (loading) {
    return <div className="text-gray-500">Loading attempts for review...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Review Submissions</h2>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {/* Filter tabs */}
      <div className="flex gap-2 mb-6">
        <button
          onClick={() => setFilter('all')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          All ({attempts.length})
        </button>
        <button
          onClick={() => setFilter('pending')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            filter === 'pending'
              ? 'bg-orange-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Pending ({pendingCount})
        </button>
        <button
          onClick={() => setFilter('graded')}
          className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
            filter === 'graded'
              ? 'bg-green-600 text-white'
              : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
          }`}
        >
          Graded ({gradedCount})
        </button>
      </div>

      <div className="space-y-4">
        {filteredAttempts.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            {filter === 'all'
              ? 'No submissions to review'
              : filter === 'pending'
                ? 'No pending submissions'
                : 'No graded submissions'}
          </div>
        ) : (
          filteredAttempts.map((attempt) => {
            const latestResult = attempt.gradingResults[0] ?? null;
            const isPending = attempt.status === 'submitted' || attempt.status === 'grading';

            return (
              <div
                key={attempt.id}
                className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
              >
                <div className="flex items-start justify-between">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                      <p className="font-medium text-gray-900">{attempt.student.name}</p>
                      <span
                        className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${
                          isPending
                            ? 'bg-orange-100 text-orange-700'
                            : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {isPending ? 'Pending' : 'Graded'}
                      </span>
                    </div>
                    <p className="text-sm text-gray-500">
                      Submitted:{' '}
                      {attempt.submittedAt ? formatDateTimeSGT(attempt.submittedAt) : 'N/A'}
                    </p>
                    <p className="text-sm text-gray-600 mt-1 truncate">
                      {attempt.question.prompt.substring(0, 100)}
                      {attempt.question.prompt.length > 100 ? '...' : ''}
                    </p>
                    {latestResult && (
                      <p className="text-sm mt-1">
                        <span className="font-medium text-gray-700">
                          Score: {latestResult.score}/{attempt.question.maxScore}
                        </span>
                        <span className="text-gray-400 mx-1">&middot;</span>
                        <span className="text-gray-500">
                          {attempt.gradingResults.length} grade
                          {attempt.gradingResults.length !== 1 ? 's' : ''}
                        </span>
                      </p>
                    )}
                  </div>
                  <button
                    onClick={() => navigate(`/teacher/attempt/${attempt.id}`)}
                    className={`ml-4 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${
                      isPending
                        ? 'bg-blue-100 text-blue-700 hover:bg-blue-200'
                        : 'bg-gray-100 text-gray-700 hover:bg-gray-200'
                    }`}
                  >
                    {isPending ? 'Grade' : 'View'}
                  </button>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
