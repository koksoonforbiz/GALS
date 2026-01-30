import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

interface Topic {
  id: string;
  title: string;
  description: string;
  orderIndex: number;
  _count: { questions: number };
}

interface Course {
  id: string;
  title: string;
  description: string | null;
  topics: Topic[];
  _count: { topics: number; enrollments: number };
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

  // Topic management state
  const [expandedCourseId, setExpandedCourseId] = useState<string | null>(null);
  const [newTopicTitle, setNewTopicTitle] = useState('');
  const [newTopicDescription, setNewTopicDescription] = useState('');
  const [creatingTopic, setCreatingTopic] = useState(false);

  const fetchCourses = async () => {
    try {
      const data = await apiFetch<Course[]>('/courses');
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
      await apiFetch<Course>('/courses', {
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

  const handleAddTopic = async (e: React.FormEvent, courseId: string) => {
    e.preventDefault();
    setCreatingTopic(true);
    setError(null);
    try {
      const course = courses.find((c) => c.id === courseId);
      await apiFetch('/topics', {
        method: 'POST',
        body: JSON.stringify({
          courseId,
          title: newTopicTitle,
          description: newTopicDescription || '',
          orderIndex: course ? course.topics.length : 0,
        }),
      });
      setNewTopicTitle('');
      setNewTopicDescription('');
      fetchCourses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add topic');
    } finally {
      setCreatingTopic(false);
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
          courses.map((course) => {
            const isExpanded = expandedCourseId === course.id;

            return (
              <div
                key={course.id}
                className="bg-white rounded-lg shadow-sm border border-gray-200"
              >
                <div
                  className="p-4 cursor-pointer hover:bg-gray-50 transition-colors"
                  onClick={() => setExpandedCourseId(isExpanded ? null : course.id)}
                >
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="text-lg font-semibold text-gray-900">{course.title}</h3>
                      {course.description && (
                        <p className="text-gray-600 mt-1">{course.description}</p>
                      )}
                      <div className="mt-2 text-sm text-gray-500">
                        {course._count.topics} topic(s)
                      </div>
                    </div>
                    <span className="text-gray-400 text-xl">{isExpanded ? '\u25B2' : '\u25BC'}</span>
                  </div>
                </div>

                {isExpanded && (
                  <div className="border-t border-gray-200 p-4">
                    <h4 className="text-sm font-semibold text-gray-700 mb-3">Topics</h4>

                    {course.topics.length > 0 ? (
                      <div className="space-y-2 mb-4">
                        {course.topics.map((topic) => (
                          <div
                            key={topic.id}
                            className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg"
                          >
                            <div>
                              <span className="text-sm font-medium text-gray-800">
                                {topic.title}
                              </span>
                              {topic.description && (
                                <p className="text-xs text-gray-500">{topic.description}</p>
                              )}
                            </div>
                            <span className="text-xs text-gray-400">
                              {topic._count.questions} question(s)
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-sm text-gray-400 mb-4">No topics yet. Add one below.</p>
                    )}

                    <form
                      onSubmit={(e) => handleAddTopic(e, course.id)}
                      className="flex gap-2 items-end"
                    >
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Topic Title
                        </label>
                        <input
                          type="text"
                          value={expandedCourseId === course.id ? newTopicTitle : ''}
                          onChange={(e) => setNewTopicTitle(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="e.g. Arithmetic, Algebra"
                          required
                        />
                      </div>
                      <div className="flex-1">
                        <label className="block text-xs font-medium text-gray-600 mb-1">
                          Description (optional)
                        </label>
                        <input
                          type="text"
                          value={expandedCourseId === course.id ? newTopicDescription : ''}
                          onChange={(e) => setNewTopicDescription(e.target.value)}
                          className="w-full px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                          placeholder="Brief description"
                        />
                      </div>
                      <button
                        type="submit"
                        disabled={creatingTopic}
                        className="px-3 py-1.5 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors whitespace-nowrap"
                      >
                        {creatingTopic ? 'Adding...' : 'Add Topic'}
                      </button>
                    </form>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
