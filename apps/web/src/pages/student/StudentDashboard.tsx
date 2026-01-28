import { useState, useEffect } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiFetch } from '../../lib/api';

interface Enrollment {
  id: string;
  courseId: string;
  course: {
    id: string;
    title: string;
  };
}

export function StudentDashboard() {
  const { user } = useAuth();
  const [enrollments, setEnrollments] = useState<Enrollment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchEnrollments = async () => {
      try {
        const data = await apiFetch<Enrollment[]>('/api/enrollments/my');
        setEnrollments(data);
      } catch {
        // Silently fail for dashboard
      } finally {
        setLoading(false);
      }
    };
    fetchEnrollments();
  }, []);

  return (
    <div>
      <h2 className="text-2xl font-bold text-gray-900 mb-6">Welcome, {user?.name}!</h2>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Enrolled Courses</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">
            {loading ? '-' : enrollments.length}
          </p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Available Assessments</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">-</p>
        </div>
        <div className="bg-white p-6 rounded-lg shadow-sm border border-gray-200">
          <h3 className="text-sm font-medium text-gray-500">Completed</h3>
          <p className="mt-2 text-3xl font-semibold text-gray-900">-</p>
        </div>
      </div>

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
