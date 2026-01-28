import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

interface Topic {
  id: string;
  title: string;
}

interface Course {
  id: string;
  title: string;
  description: string | null;
  topics: Topic[];
  createdAt: string;
}

export function CoursesPage() {
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  const [creating, setCreating] = useState(false);

  const fetchCourses = async () => {
    try {
      const data = await apiFetch<Course[]>('/api/courses');
      setCourses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load courses');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchCourses();
  }, []);

  const handleCreateCourse = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    try {
      await apiFetch<Course>('/api/courses', {
        method: 'POST',
        body: JSON.stringify({
          title: newCourseName,
          description: newCourseDescription || undefined,
        }),
      });
      setNewCourseName('');
      setNewCourseDescription('');
      setShowCreateForm(false);
      fetchCourses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create course');
    } finally {
      setCreating(false);
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading courses...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Courses</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showCreateForm ? 'Cancel' : 'Create Course'}
        </button>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {showCreateForm && (
        <form
          onSubmit={handleCreateCourse}
          className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Course Name</label>
              <input
                type="text"
                value={newCourseName}
                onChange={(e) => setNewCourseName(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <textarea
                value={newCourseDescription}
                onChange={(e) => setNewCourseDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={3}
              />
            </div>
            <button
              type="submit"
              disabled={creating}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {courses.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No courses yet. Create your first course!
          </div>
        ) : (
          courses.map((course) => (
            <div
              key={course.id}
              className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
            >
              <h3 className="text-lg font-semibold text-gray-900">{course.title}</h3>
              {course.description && <p className="text-gray-600 mt-1">{course.description}</p>}
              <div className="mt-2 text-sm text-gray-500">{course.topics.length} topic(s)</div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
