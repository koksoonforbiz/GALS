import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';

interface Enrollment {
  id: string;
  courseId: string;
  status: string;
  enrolledAt: string;
  course: {
    id: string;
    title: string;
    description: string;
    teacher: { id: string; name: string };
    _count: { topics: number; assessments: number; modules: number };
  };
}

export function MyCoursesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);
  const [dropping, setDropping] = useState<string | null>(null);

  const fetchEnrollments = async () => {
    try {
      const data = await apiFetch<Enrollment[]>('/enrollments/my');
      setEnrollments(data);
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to load courses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchEnrollments();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDrop = async (courseId: string, courseTitle: string) => {
    if (!confirm(`Drop "${courseTitle}"? Your work will be preserved, but you won't see this course.`))
      return;

    setDropping(courseId);
    try {
      await apiFetch(`/enrollments/${courseId}/drop`, { method: 'POST' });
      toast('success', `Dropped "${courseTitle}"`);
      fetchEnrollments();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to drop course');
    } finally {
      setDropping(null);
    }
  };

  if (loading) return <div className="text-gray-500">Loading your courses...</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">My Courses</h2>
          <p className="text-gray-500 text-sm mt-1">Courses you are currently enrolled in.</p>
        </div>
        <button
          onClick={() => navigate('/student/catalog')}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm"
        >
          Browse Catalog
        </button>
      </div>

      {enrollments.length === 0 ? (
        <div className="text-center py-12">
          <p className="text-gray-400 mb-4">You are not enrolled in any courses yet.</p>
          <button
            onClick={() => navigate('/student/catalog')}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Browse Course Catalog
          </button>
        </div>
      ) : (
        <div className="space-y-4">
          {enrollments.map((enrollment) => {
            const { course } = enrollment;
            return (
              <div
                key={enrollment.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200 p-4"
              >
                <div className="flex items-start justify-between">
                  <div
                    className="flex-1 cursor-pointer"
                    onClick={() => navigate(`/student/courses/${course.id}`)}
                  >
                    <h3 className="text-lg font-semibold text-gray-900 hover:text-blue-600 transition-colors">
                      {course.title}
                    </h3>
                    <p className="text-sm text-gray-500 mt-0.5">by {course.teacher.name}</p>
                    {course.description && (
                      <p className="text-sm text-gray-600 mt-1 line-clamp-2">
                        {course.description}
                      </p>
                    )}
                    <div className="flex gap-4 mt-2 text-xs text-gray-400">
                      <span>{course._count.modules} module(s)</span>
                      <span>{course._count.topics} topic(s)</span>
                      <span>{course._count.assessments} assessment(s)</span>
                    </div>
                  </div>
                  <div className="flex gap-2 ml-4">
                    <button
                      onClick={() => navigate(`/student/courses/${course.id}`)}
                      className="px-3 py-1.5 text-sm bg-blue-100 text-blue-700 rounded-lg hover:bg-blue-200 transition-colors"
                    >
                      View
                    </button>
                    <button
                      onClick={() => handleDrop(course.id, course.title)}
                      disabled={dropping === course.id}
                      className="px-3 py-1.5 text-sm bg-red-100 text-red-700 rounded-lg hover:bg-red-200 disabled:opacity-50 transition-colors"
                    >
                      {dropping === course.id ? 'Dropping...' : 'Drop'}
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
