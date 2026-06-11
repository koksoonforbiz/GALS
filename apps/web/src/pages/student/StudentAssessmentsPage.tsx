import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { usePageContext } from '../../contexts/PageContext';
import { useActivityLog } from '../../lib/activity-log';

interface AssessmentQuestion {
  id: string;
  questionId: string;
}

interface Assessment {
  id: string;
  title: string;
  description: string | null;
  courseId: string;
  mode?: string;
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
  const { setPageContext } = usePageContext();
  const { track } = useActivityLog();

  useEffect(() => {
    setPageContext({
      pageType: 'other',
      courseId: null,
      contentId: null,
      contentTitle: 'Assessments',
    });
  }, [setPageContext]);
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [attempts, setAttempts] = useState<Attempt[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [assessmentsData, attemptsData] = await Promise.all([
          apiFetch<Assessment[]>('/assessments/available'),
          apiFetch<Attempt[]>('/attempts/my'),
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

  const handleStartAttempt = (assessment: Assessment) => {
    track('ASSESSMENT_STARTED', {
      assessmentId: assessment.id,
      courseId: assessment.courseId,
      metadata: { summary: `Started assessment: ${assessment.title}` },
    });
    navigate(`/student/courses/${assessment.courseId}/assessment/${assessment.id}`);
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
                      {assessment.mode && (
                        <span
                          className={`text-xs px-2 py-1 rounded-full font-medium ${
                            assessment.mode === 'test'
                              ? 'bg-red-100 text-red-800'
                              : 'bg-blue-100 text-blue-800'
                          }`}
                        >
                          {assessment.mode}
                        </span>
                      )}
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
                      className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
                    >
                      {isInProgress ? 'Continue' : 'Start'}
                    </button>
                  )}
                  {isCompleted && (
                    <button
                      onClick={() =>
                        navigate(
                          `/student/courses/${assessment.courseId}/assessment/${assessment.id}`,
                        )
                      }
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
