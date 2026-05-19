import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { useToast } from '../../components/Toast';

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
  status: 'DRAFT' | 'PUBLISHED';
  visibility: 'PUBLIC' | 'PRIVATE';
  learningMode: string;
  topics: Topic[];
  _count: { topics: number; enrollments: number; modules: number };
  createdAt: string;
}

export function CoursesPage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [newCourseName, setNewCourseName] = useState('');
  const [newCourseDescription, setNewCourseDescription] = useState('');
  const [creating, setCreating] = useState(false);

  // Filters
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'DRAFT' | 'PUBLISHED'>('all');

  // Topic management
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
          description: newCourseDescription || '',
        }),
      });
      setNewCourseName('');
      setNewCourseDescription('');
      setShowCreateForm(false);
      toast('success', 'Course created');
      fetchCourses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create course');
    } finally {
      setCreating(false);
    }
  };

  const handlePublish = async (course: Course) => {
    try {
      const endpoint = course.status === 'PUBLISHED' ? 'unpublish' : 'publish';
      await apiFetch(`/courses/${course.id}/${endpoint}`, { method: 'POST' });
      toast('success', course.status === 'PUBLISHED' ? 'Course unpublished' : 'Course published');
      fetchCourses();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to update course');
    }
  };

  const handleDuplicate = async (course: Course) => {
    try {
      await apiFetch(`/courses/${course.id}/duplicate`, { method: 'POST' });
      toast('success', `Duplicated "${course.title}"`);
      fetchCourses();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to duplicate');
    }
  };

  const handleArchive = async (course: Course) => {
    if (!confirm(`Archive "${course.title}"? This will hide it from students.`)) return;
    try {
      await apiFetch(`/courses/${course.id}`, { method: 'DELETE' });
      toast('success', `Archived "${course.title}"`);
      fetchCourses();
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to archive');
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
      toast('success', 'Topic added');
      fetchCourses();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add topic');
    } finally {
      setCreatingTopic(false);
    }
  };

  const filteredCourses = courses.filter((c) => {
    if (statusFilter !== 'all' && c.status !== statusFilter) return false;
    if (search && !c.title.toLowerCase().includes(search.toLowerCase())) return false;
    return true;
  });

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

      {/* Search & Filter Bar */}
      <div className="flex gap-3 mb-4">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search courses..."
          className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
        />
        <div className="flex gap-1">
          {(['all', 'DRAFT', 'PUBLISHED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 text-sm rounded-lg transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {s === 'all' ? 'All' : s === 'DRAFT' ? 'Draft' : 'Published'}
            </button>
          ))}
        </div>
      </div>

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
        {filteredCourses.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            {courses.length === 0
              ? 'No courses yet. Create your first course!'
              : 'No courses match your filters.'}
          </div>
        ) : (
          filteredCourses.map((course) => {
            const isExpanded = expandedCourseId === course.id;

            return (
              <div key={course.id} className="bg-white rounded-lg shadow-sm border border-gray-200">
                <div className="p-4">
                  <div className="flex items-start justify-between">
                    <div
                      className="flex-1 cursor-pointer"
                      onClick={() => setExpandedCourseId(isExpanded ? null : course.id)}
                    >
                      <div className="flex items-center gap-2">
                        <h3 className="text-lg font-semibold text-gray-900">{course.title}</h3>
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                            course.status === 'PUBLISHED'
                              ? 'bg-green-100 text-green-800'
                              : 'bg-yellow-100 text-yellow-800'
                          }`}
                        >
                          {course.status === 'PUBLISHED' ? 'Published' : 'Draft'}
                        </span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-600">
                          {course.visibility}
                        </span>
                        {course.learningMode === 'DIALOGUE' && (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-purple-100 text-purple-700 font-medium">
                            Dialogue
                          </span>
                        )}
                      </div>
                      {course.description && (
                        <p className="text-gray-600 mt-1 text-sm">{course.description}</p>
                      )}
                      <div className="mt-2 text-sm text-gray-500 flex gap-4">
                        <span>{course._count.topics} topic(s)</span>
                        <span>{course._count.modules} module(s)</span>
                        <span>{course._count.enrollments} student(s)</span>
                      </div>
                    </div>
                    <div className="flex gap-1 ml-4">
                      <button
                        onClick={() => navigate(`/teacher/courses/${course.id}`)}
                        className="px-2 py-1 text-xs bg-blue-100 text-blue-700 rounded hover:bg-blue-200 transition-colors"
                        title="Edit course content"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => handleDuplicate(course)}
                        className="px-2 py-1 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200 transition-colors"
                        title="Duplicate course"
                      >
                        Duplicate
                      </button>
                      <button
                        onClick={() => handlePublish(course)}
                        className={`px-2 py-1 text-xs rounded transition-colors ${
                          course.status === 'PUBLISHED'
                            ? 'bg-yellow-100 text-yellow-700 hover:bg-yellow-200'
                            : 'bg-green-100 text-green-700 hover:bg-green-200'
                        }`}
                      >
                        {course.status === 'PUBLISHED' ? 'Unpublish' : 'Publish'}
                      </button>
                      <button
                        onClick={() => handleArchive(course)}
                        className="px-2 py-1 text-xs bg-red-100 text-red-700 rounded hover:bg-red-200 transition-colors"
                        title="Archive course"
                      >
                        Archive
                      </button>
                    </div>
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
