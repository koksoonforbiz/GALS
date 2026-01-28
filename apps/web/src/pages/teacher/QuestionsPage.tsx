import { useState, useEffect } from 'react';
import { apiFetch } from '../../lib/api';

interface Question {
  id: string;
  topicId: string;
  type: string;
  prompt: string;
  rubricJson: Record<string, unknown> | null;
  maxScore: number;
  version: number;
  createdAt: string;
}

interface Topic {
  id: string;
  title: string;
  courseId: string;
}

interface Course {
  id: string;
  title: string;
  topics: Topic[];
}

export function QuestionsPage() {
  const [questions, setQuestions] = useState<Question[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [creating, setCreating] = useState(false);

  const [selectedTopicId, setSelectedTopicId] = useState('');
  const [questionType, setQuestionType] = useState<'text' | 'drawing' | 'mixed'>('text');
  const [prompt, setPrompt] = useState('');
  const [maxScore, setMaxScore] = useState(10);
  const [rubricJson, setRubricJson] = useState('{"answer_key": []}');

  const fetchData = async () => {
    try {
      const [questionsData, coursesData] = await Promise.all([
        apiFetch<Question[]>('/api/questions'),
        apiFetch<Course[]>('/api/courses'),
      ]);
      setQuestions(questionsData);
      setCourses(coursesData);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load data');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  const handleCreateQuestion = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);

    try {
      const parsedRubric = JSON.parse(rubricJson);
      await apiFetch<Question>('/api/questions', {
        method: 'POST',
        body: JSON.stringify({
          topicId: selectedTopicId,
          type: questionType,
          prompt,
          maxScore,
          rubricJson: parsedRubric,
        }),
      });
      setShowCreateForm(false);
      setPrompt('');
      setRubricJson('{"answer_key": []}');
      fetchData();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create question');
    } finally {
      setCreating(false);
    }
  };

  const allTopics = courses.flatMap((c) => c.topics.map((t) => ({ ...t, courseTitle: c.title })));

  if (loading) {
    return <div className="text-gray-500">Loading questions...</div>;
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Questions</h2>
        <button
          onClick={() => setShowCreateForm(!showCreateForm)}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
        >
          {showCreateForm ? 'Cancel' : 'Create Question'}
        </button>
      </div>

      {error && <div className="mb-4 p-4 bg-red-50 text-red-700 rounded-lg">{error}</div>}

      {showCreateForm && (
        <form
          onSubmit={handleCreateQuestion}
          className="mb-6 p-4 bg-white rounded-lg shadow-sm border border-gray-200"
        >
          <div className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
              <select
                value={selectedTopicId}
                onChange={(e) => setSelectedTopicId(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                required
              >
                <option value="">Select a topic</option>
                {allTopics.map((topic) => (
                  <option key={topic.id} value={topic.id}>
                    {topic.courseTitle} - {topic.title}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Question Type</label>
              <select
                value={questionType}
                onChange={(e) => setQuestionType(e.target.value as 'text' | 'drawing' | 'mixed')}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              >
                <option value="text">Text</option>
                <option value="drawing">Drawing</option>
                <option value="mixed">Mixed</option>
              </select>
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Prompt (MDX)</label>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                rows={6}
                placeholder="# Question Title&#10;&#10;What is the process by which plants convert sunlight into energy?&#10;&#10;$$E = mc^2$$"
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Max Score</label>
              <input
                type="number"
                value={maxScore}
                onChange={(e) => setMaxScore(Number(e.target.value))}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                min={1}
                required
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Rubric JSON</label>
              <textarea
                value={rubricJson}
                onChange={(e) => setRubricJson(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 font-mono text-sm"
                rows={4}
                placeholder='{"answer_key": ["answer1", "answer2"]}'
              />
              <p className="mt-1 text-xs text-gray-500">
                For auto-grading, include an answer_key array with acceptable answers
              </p>
            </div>

            <button
              type="submit"
              disabled={creating || !selectedTopicId}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create Question'}
            </button>
          </div>
        </form>
      )}

      <div className="space-y-4">
        {questions.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No questions yet. Create your first question!
          </div>
        ) : (
          questions.map((question) => (
            <div
              key={question.id}
              className="bg-white p-4 rounded-lg shadow-sm border border-gray-200"
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <span
                      className={`text-xs px-2 py-1 rounded-full font-medium ${
                        question.type === 'text'
                          ? 'bg-blue-100 text-blue-800'
                          : question.type === 'drawing'
                            ? 'bg-purple-100 text-purple-800'
                            : 'bg-green-100 text-green-800'
                      }`}
                    >
                      {question.type}
                    </span>
                    <span className="text-xs text-gray-500">
                      v{question.version} | Max: {question.maxScore} pts
                    </span>
                  </div>
                  <pre className="text-sm text-gray-700 whitespace-pre-wrap font-mono bg-gray-50 p-2 rounded">
                    {question.prompt.substring(0, 200)}
                    {question.prompt.length > 200 ? '...' : ''}
                  </pre>
                </div>
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
