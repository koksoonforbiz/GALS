import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

interface Question {
  id: string;
  prompt: string;
  type: string;
  maxScore: number;
}

interface AssessmentQuestion {
  id: string;
  questionId: string;
  orderIndex: number;
  question: Question;
}

interface Assessment {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  assessmentQuestions: AssessmentQuestion[];
  createdAt: string;
}

interface Course {
  id: string;
  title: string;
}

export function AssessmentsPage() {
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [questions, setQuestions] = useState<Question[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [selectedCourseId, setSelectedCourseId] = useState('');
  const [selectedQuestionIds, setSelectedQuestionIds] = useState<string[]>([]);

  const fetchData = async () => {
    try {
      const [assessmentsData, coursesData, questionsData] = await Promise.all([
        apiFetch<Assessment[]>('/api/assessments'),
        apiFetch<Course[]>('/api/courses'),
        apiFetch<Question[]>('/api/questions'),
      ]);
      setAssessments(assessmentsData);
      setCourses(coursesData);
      setQuestions(questionsData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateAssessment = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      await apiFetch<Assessment>('/api/assessments', {
        method: 'POST',
        body: JSON.stringify({
          courseId: selectedCourseId,
          title,
          description: description || undefined,
          questionIds: selectedQuestionIds,
        }),
      });
      setShowCreateForm(false);
      setTitle('');
      setDescription('');
      setSelectedQuestionIds([]);
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assessment');
    } finally {
      setCreating(false);
    }
  };

  const toggleQuestionSelection = (questionId: string) => {
    setSelectedQuestionIds((prev) =>
      prev.includes(questionId) ? prev.filter((id) => id !== questionId) : [...prev, questionId],
    );
  };

  const handlePublishToggle = async (assessment: Assessment) => {
    try {
      await apiFetch(`/api/assessments/${assessment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: !assessment.isPublished }),
      });
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update assessment');
    }
  };

  if (loading) {
    return <div className="text-gray-500">Loading assessments...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Assessments</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showCreateForm ? 'Cancel' : 'Create Assessment'}
        </button>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {showCreateForm && (
        <form
          onSubmit={handleCreateAssessment}
          className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
              <select
                value={selectedCourseId}
                onChange={(e) => setSelectedCourseId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="">Select a course</option>
                {courses.map((course) => (
                  <option key={course.id} value={course.id}>
                    {course.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
              <input
                type="text"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Description (optional)
              </label>
              <textarea
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                rows={2}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Select Questions
              </label>
              <div className="space-y-2 max-h-60 overflow-y-auto border border-gray-200 rounded-lg p-2">
                {questions.length === 0 ? (
                  <p className="text-gray-500 text-sm">No questions available</p>
                ) : (
                  questions.map((question) => (
                    <label
                      key={question.id}
                      className="flex items-start gap-2 p-2 hover:bg-gray-50 rounded cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={selectedQuestionIds.includes(question.id)}
                        onChange={() => toggleQuestionSelection(question.id)}
                        className="mt-1"
                      />
                      <div className="flex-1">
                        <span className="text-xs text-gray-500">{question.type}</span>
                        <p className="text-sm text-gray-700">
                          {question.prompt.substring(0, 100)}
                          {question.prompt.length > 100 ? '...' : ''}
                        </p>
                      </div>
                    </label>
                  ))
                )}
              </div>
              <p className="mt-1 text-xs text-gray-500">
                {selectedQuestionIds.length} question(s) selected
              </p>
            </div>

            <button
              type="submit"
              disabled={creating || !selectedCourseId || selectedQuestionIds.length === 0}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create Assessment'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {assessments.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No assessments yet. Create your first assessment!
          </div>
        ) : (
          assessments.map((assessment) => (
            <div
              key={assessment.id}
              className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
            >
              <div className="flex items-start justify-between">
                <div>
                  <div className="flex items-center gap-2">
                    <h3 className="text-lg font-semibold text-gray-900">{assessment.title}</h3>
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        assessment.isPublished
                          ? 'bg-green-100 text-green-800'
                          : 'bg-yellow-100 text-yellow-800'
                      }`}
                    >
                      {assessment.isPublished ? 'Published' : 'Draft'}
                    </span>
                  </div>
                  {assessment.description && (
                    <p className="text-gray-600 mt-1">{assessment.description}</p>
                  )}
                  <p className="text-sm text-gray-500 mt-2">
                    {assessment.assessmentQuestions.length} question(s)
                  </p>
                </div>
                <button
                  onClick={() => handlePublishToggle(assessment)}
                  className={`px-3 py-1 text-sm rounded-lg transition-colors ${
                    assessment.isPublished
                      ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                      : 'bg-green-100 text-green-800 hover:bg-green-200'
                  }`}
                >
                  {assessment.isPublished ? 'Unpublish' : 'Publish'}
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
