import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../contexts/AuthContext';
import { usePageContext } from '../../contexts/PageContext';
import { apiFetch } from '../../lib/api';

interface Enrollment {
  id: string;
  courseId: string;
  course: {
    id: string;
    title: string;
  };
}

interface KcMasteryItem {
  kcId: string;
  code: string;
  label: string;
  probabilityKnown: number;
  totalAttempts: number;
  correctAttempts: number;
  lastAttemptAt: string | null;
}

interface MasteryByTopic {
  topicId: string;
  topicTitle: string;
  courseId: string;
  courseTitle: string;
  kcs: KcMasteryItem[];
}

interface Assessment {
  id: string;
  title: string;
}

export function StudentDashboard() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { setPageContext } = usePageContext();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [masteryData, setMasteryData] = useState<MasteryByTopic[]>([]);
  const [loading, setLoading] = useState(true);
  const [masteryLoading, setMasteryLoading] = useState(true);
  const [generatingWorksheet, setGeneratingWorksheet] = useState(false);
  const [worksheetError, setWorksheetError] = useState<string | null>(null);

  useEffect(() => {
    setPageContext({ pageType: 'dashboard', courseId: null, contentId: null, contentTitle: null });
  }, [setPageContext]);

  useEffect(() => {
    const fetchData = async () => {
      try {
        const data = await apiFetch<Enrollment[]>('/enrollments/my');
        setEnrollments(data);
      } catch {
        // Silently fail for dashboard
      } finally {
        setLoading(false);
      }
    };

    const fetchMastery = async () => {
      try {
        const data = await apiFetch<MasteryByTopic[]>('/me/mastery');
        setMasteryData(data);
      } catch {
        // Silently fail
      } finally {
        setMasteryLoading(false);
      }
    };

    fetchData();
    fetchMastery();
  }, []);

  const handleGenerateWorksheet = async () => {
    setGeneratingWorksheet(true);
    setWorksheetError(null);
    try {
      const assessment = await apiFetch<Assessment>('/me/revise-worksheet', {
        method: 'POST',
      });
      void assessment;
      navigate('/student/assessments');
    } catch (err) {
      setWorksheetError(err instanceof Error ? err.message : 'Failed to generate worksheet');
    } finally {
      setGeneratingWorksheet(false);
    }
  };

  // Compute stats
  const allKcs = masteryData.flatMap((t) => t.kcs);
  const avgMastery =
    allKcs.length > 0
      ? Math.round((allKcs.reduce((sum, kc) => sum + kc.probabilityKnown, 0) / allKcs.length) * 100)
      : null;
  const weakKcs = [...allKcs].sort((a, b) => a.probabilityKnown - b.probabilityKnown).slice(0, 5);

  const getMasteryColor = (p: number) => {
    if (p >= 0.7) return 'bg-green-500';
    if (p >= 0.3) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getMasteryTextColor = (p: number) => {
    if (p >= 0.7) return 'text-green-700';
    if (p >= 0.3) return 'text-yellow-700';
    return 'text-red-700';
  };

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Welcome, {user?.name}!</h2>

      {/* Stat Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Enrolled Courses</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">
            {loading ? '-' : enrollments.length}
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Overall Mastery</h3>
          <p
            className={`mt-2 text-3xl font-semibold ${
              avgMastery !== null
                ? avgMastery >= 70
                  ? 'text-green-600'
                  : avgMastery >= 30
                    ? 'text-yellow-600'
                    : 'text-red-600'
                : 'text-gray-900'
            }`}
          >
            {masteryLoading ? '-' : avgMastery !== null ? `${avgMastery}%` : '-'}
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Knowledge Components</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">
            {masteryLoading ? '-' : allKcs.length}
          </p>
        </div>
      </div>

      {/* Mastery Map by Topic */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Mastery Map</h3>
        {masteryLoading ? (
          <p className="text-gray-500">Loading mastery data...</p>
        ) : masteryData.length === 0 ? (
          <p className="text-gray-500">
            No mastery data yet. Complete some assessments to see your progress.
          </p>
        ) : (
          <div className="space-y-6">
            {masteryData.map((topic) => (
              <div key={topic.topicId}>
                <div className="flex items-center gap-2 mb-2">
                  <h4 className="text-sm font-semibold text-gray-800">{topic.topicTitle}</h4>
                  <span className="text-xs text-gray-400">{topic.courseTitle}</span>
                </div>
                <div className="space-y-2">
                  {topic.kcs.map((kc) => {
                    const pct = Math.round(kc.probabilityKnown * 100);
                    return (
                      <div key={kc.kcId} className="flex items-center gap-3">
                        <div className="w-32 text-xs text-gray-600 truncate" title={kc.label}>
                          {kc.label}
                        </div>
                        <div className="flex-1 h-4 bg-gray-100 rounded-full overflow-hidden">
                          <div
                            className={`h-full rounded-full transition-all ${getMasteryColor(kc.probabilityKnown)}`}
                            style={{ width: `${pct}%` }}
                          />
                        </div>
                        <div
                          className={`w-12 text-xs font-medium text-right ${getMasteryTextColor(kc.probabilityKnown)}`}
                        >
                          {pct}%
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Weak KCs */}
      {weakKcs.length > 0 && (
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200 mb-6">
          <h3 className="text-lg font-semibold text-gray-900 mb-4">Areas to Improve</h3>
          <div className="space-y-2">
            {weakKcs.map((kc) => {
              const pct = Math.round(kc.probabilityKnown * 100);
              return (
                <div
                  key={kc.kcId}
                  className="flex items-center justify-between p-2 rounded-lg bg-red-50 border border-red-100"
                >
                  <div>
                    <p className="text-sm font-medium text-gray-800">{kc.label}</p>
                    <p className="text-xs text-gray-500">
                      {kc.correctAttempts}/{kc.totalAttempts} correct
                    </p>
                  </div>
                  <div className={`text-sm font-bold ${getMasteryTextColor(kc.probabilityKnown)}`}>
                    {pct}%
                  </div>
                </div>
              );
            })}
          </div>

          {/* Generate Revision Worksheet */}
          <div className="mt-4">
            <button
              onClick={handleGenerateWorksheet}
              disabled={generatingWorksheet}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm"
            >
              {generatingWorksheet ? 'Generating...' : 'Generate Revision Worksheet'}
            </button>
            {worksheetError && <p className="mt-2 text-sm text-red-600">{worksheetError}</p>}
          </div>
        </div>
      )}

      {/* Your Courses */}
      <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">Your Courses</h3>
        {loading ? (
          <p className="text-gray-500">Loading...</p>
        ) : enrollments.length === 0 ? (
          <p className="text-gray-500">You are not enrolled in any courses yet.</p>
        ) : (
          <ul className="space-y-2">
            {enrollments.map((enrollment) => (
              <li key={enrollment.id} className="p-3 bg-gray-50 rounded-lg text-gray-700">
                {enrollment.course.title}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
