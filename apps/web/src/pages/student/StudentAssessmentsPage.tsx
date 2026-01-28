import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

interface AssessmentQuestion {
  id: string;
  questionId: string;
}

interface Assessment {
  id: string;
  title: string;
  description: string | null;
  courseId: string;
  course: {
    id: string;
    title: string;
  };
  assessmentQuestions: AssessmentQuestion[];
}

interface Attempt {
  id: string;
  assessmentId: string;
  status: string;
}

export function StudentAssessmentsPage() {
  const navigate = useNavigate();
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [assessmentsData, attemptsData] = await Promise.all([
          apiFetch<Assessment[]>('/api/assessments/available'),
          apiFetch<Attempt[]>('/api/attempts/my'),
        ]);
        setAssessments(assessmentsData);
        setAttempts(attemptsData);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load assessments');
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, []);

  const getAttemptForAssessment = (assessmentId: string) => {
    return attempts.find((a) => a.assessmentId === assessmentId);
  };

  const handleStartAttempt = async (assessment: Assessment) => {
    const existingAttempt = getAttemptForAssessment(assessment.id);
    if (existingAttempt && existingAttempt.status === 'in_progress') {
      navigate(`/student/attempt/${existingAttempt.id}`);
      return;
    }

    setStarting(assessment.id);
    setError(null);

    try {
      const attempt = await apiFetch<Attempt>('/api/attempts', {
        method: 'POST',
        body: JSON.stringify({
          assessmentId: assessment.id,
        }),
      });
      navigate(`/student/attempt/${attempt.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start assessment');
    } finally {
      setStarting(null);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading assessments...</div>;
  }

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Available Assessments</h2>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      <div className="space-y-4">
        {assessments.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No assessments available at this time.
          </div>
        ) : (
          assessments.map((assessment) => {
            const attempt = getAttemptForAssessment(assessment.id);
            const isInProgress = attempt?.status === 'in_progress';
            const isCompleted = attempt?.status === 'graded' || attempt?.status === 'submitted';

            return (
              <div
                key={assessment.id}
                className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <h3 className="text-lg font-semibold text-gray-900">{assessment.title}</h3>
                      {isCompleted && (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-green-100 text-green-800">
                          Completed
                        </span>
                      )}
                      {isInProgress && (
                        <span className="text-xs px-2 py-1 rounded-full font-medium bg-yellow-100 text-yellow-800">
                          In Progress
                        </span>
                      )}
                    </div>
                    <p className="text-sm text-gray-500 mt-1">{assessment.course.title}</p>
                    {assessment.description && (
                      <p className="text-gray-600 mt-2">{assessment.description}</p>
                    )}
                    <p className="text-sm text-gray-500 mt-2">
                      {assessment.assessmentQuestions.length} question(s)
                    </p>
                  </div>
                  {!isCompleted && (
                    <button
                      onClick={() => handleStartAttempt(assessment)}
                      disabled={starting === assessment.id}
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
                    >
                      {starting === assessment.id
                        ? 'Starting...'
                        : isInProgress
                          ? 'Continue'
                          : 'Start'}
                    </button>
                  )}
                  {isCompleted && (
                    <button
                      onClick={() => navigate(`/student/results/${attempt?.id}`)}
                      className="px-4 py-2 bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 transition-colors"
                    >
                      View Results
                    </button>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
