import { useState, useEffect, useCallback, useMemo } from 'react';
import { apiFetch } from '../../lib/api';
import { formatDateSGT } from '../../lib/formatDateTime';

/* ------------------------------------------------------------------ */
/*  Types                                                             */
/* ------------------------------------------------------------------ */

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
  points: number;
  section: string | null;
  question: Question;
}

interface AssessmentSettings {
  timeLimit?: number | null;
  maxAttempts?: number | null;
  showSolutions?: boolean;
  shuffle?: boolean;
}

interface Assessment {
  id: string;
  courseId: string;
  title: string;
  description: string | null;
  isPublished: boolean;
  mode: 'practice' | 'test';
  settings: AssessmentSettings;
  questions: AssessmentQuestion[];
  course: { id: string; title: string };
  createdAt: string;
}

interface Course {
  id: string;
  title: string;
}

type View = 'list' | 'create' | 'builder';

/* ------------------------------------------------------------------ */
/*  Helpers                                                           */
/* ------------------------------------------------------------------ */

function formatDate(iso: string) {
  return formatDateSGT(iso);
}

function totalPoints(qs: AssessmentQuestion[]) {
  return qs.reduce((s, q) => s + (q.points ?? 0), 0);
}

/* ------------------------------------------------------------------ */
/*  Component                                                         */
/* ------------------------------------------------------------------ */

export function AssessmentsPage() {
  /* ---- shared state ---- */
  const [assessments, setAssessments] = useState<Assessment[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>('list');

  /* ---- create form state ---- */
  const [createCourseId, setCreateCourseId] = useState('');
  const [createTitle, setCreateTitle] = useState('');
  const [createDesc, setCreateDesc] = useState('');
  const [createMode, setCreateMode] = useState<'practice' | 'test'>('practice');
  const [createTimeLimit, setCreateTimeLimit] = useState('');
  const [createMaxAttempts, setCreateMaxAttempts] = useState('');
  const [createShowSolutions, setCreateShowSolutions] = useState(false);
  const [createShuffle, setCreateShuffle] = useState(false);
  const [creating, setCreating] = useState(false);

  /* ---- builder state ---- */
  const [activeAssessment, setActiveAssessment] = useState<Assessment | null>(null);
  const [bankQuestions, setBankQuestions] = useState<Question[]>([]);
  const [bankSearch, setBankSearch] = useState('');
  const [bankTypeFilter, setBankTypeFilter] = useState('');
  const [bankLoading, setBankLoading] = useState(false);

  /* ---- settings editor (inline on builder) ---- */
  const [editTitle, setEditTitle] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [editMode, setEditMode] = useState<'practice' | 'test'>('practice');
  const [editTimeLimit, setEditTimeLimit] = useState('');
  const [editMaxAttempts, setEditMaxAttempts] = useState('');
  const [editShowSolutions, setEditShowSolutions] = useState(false);
  const [editShuffle, setEditShuffle] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [savingSettings, setSavingSettings] = useState(false);

  /* ---- delete confirmation ---- */
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  /* ================================================================ */
  /*  Data fetching                                                   */
  /* ================================================================ */

  const fetchAssessments = useCallback(async () => {
    try {
      const data = await apiFetch<Assessment[]>('/assessments');
      setAssessments(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load assessments');
    }
  }, []);

  const fetchCourses = useCallback(async () => {
    try {
      const data = await apiFetch<Course[]>('/courses');
      setCourses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load courses');
    }
  }, []);

  useEffect(() => {
    Promise.all([fetchAssessments(), fetchCourses()]).finally(() => setLoading(false));
  }, [fetchAssessments, fetchCourses]);

  /* fetch question bank for a course */
  const fetchBank = useCallback(async (courseId: string) => {
    setBankLoading(true);
    try {
      const data = await apiFetch<Question[]>(`/questions/course/${courseId}`);
      setBankQuestions(data);
    } catch {
      setBankQuestions([]);
    } finally {
      setBankLoading(false);
    }
  }, []);

  /* refresh the active assessment in-place */
  const refreshActive = useCallback(async (id: string) => {
    const updated = await apiFetch<Assessment>(`/assessments/${id}`);
    setActiveAssessment(updated);
    setAssessments((prev) => prev.map((a) => (a.id === id ? updated : a)));
  }, []);

  /* ================================================================ */
  /*  Handlers — list                                                 */
  /* ================================================================ */

  const handlePublishToggle = async (a: Assessment) => {
    try {
      await apiFetch(`/assessments/${a.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ isPublished: !a.isPublished }),
      });
      await fetchAssessments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update');
    }
  };

  const handleDelete = async (id: string) => {
    try {
      await apiFetch(`/assessments/${id}`, { method: 'DELETE' });
      setDeleteTarget(null);
      if (activeAssessment?.id === id) {
        setActiveAssessment(null);
        setView('list');
      }
      await fetchAssessments();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete');
    }
  };

  const openBuilder = (a: Assessment) => {
    setActiveAssessment(a);
    setEditTitle(a.title);
    setEditDesc(a.description ?? '');
    setEditMode(a.mode);
    setEditTimeLimit(a.settings.timeLimit ? String(a.settings.timeLimit) : '');
    setEditMaxAttempts(a.settings.maxAttempts ? String(a.settings.maxAttempts) : '');
    setEditShowSolutions(a.settings.showSolutions ?? false);
    setEditShuffle(a.settings.shuffle ?? false);
    setBankSearch('');
    setBankTypeFilter('');
    setShowSettings(false);
    setView('builder');
    fetchBank(a.courseId);
  };

  /* ================================================================ */
  /*  Handlers — create                                               */
  /* ================================================================ */

  const resetCreateForm = () => {
    setCreateCourseId('');
    setCreateTitle('');
    setCreateDesc('');
    setCreateMode('practice');
    setCreateTimeLimit('');
    setCreateMaxAttempts('');
    setCreateShowSolutions(false);
    setCreateShuffle(false);
  };

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    setCreating(true);
    setError(null);
    try {
      const settings: AssessmentSettings = {};
      if (createTimeLimit) settings.timeLimit = Number(createTimeLimit);
      if (createMaxAttempts) settings.maxAttempts = Number(createMaxAttempts);
      settings.showSolutions = createShowSolutions;
      settings.shuffle = createShuffle;

      await apiFetch<Assessment>('/assessments', {
        method: 'POST',
        body: JSON.stringify({
          courseId: createCourseId,
          title: createTitle,
          description: createDesc || undefined,
          mode: createMode,
          settings,
        }),
      });
      resetCreateForm();
      await fetchAssessments();
      setView('list');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create assessment');
    } finally {
      setCreating(false);
    }
  };

  /* ================================================================ */
  /*  Handlers — builder                                              */
  /* ================================================================ */

  const handleSaveSettings = async () => {
    if (!activeAssessment) return;
    setSavingSettings(true);
    setError(null);
    try {
      const settings: AssessmentSettings = {};
      if (editTimeLimit) settings.timeLimit = Number(editTimeLimit);
      if (editMaxAttempts) settings.maxAttempts = Number(editMaxAttempts);
      settings.showSolutions = editShowSolutions;
      settings.shuffle = editShuffle;

      await apiFetch(`/assessments/${activeAssessment.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          title: editTitle,
          description: editDesc || undefined,
          mode: editMode,
          settings,
        }),
      });
      await refreshActive(activeAssessment.id);
      setShowSettings(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddQuestion = async (questionId: string) => {
    if (!activeAssessment) return;
    try {
      await apiFetch(`/assessments/${activeAssessment.id}/questions`, {
        method: 'POST',
        body: JSON.stringify({ questionId }),
      });
      await refreshActive(activeAssessment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add question');
    }
  };

  const handleRemoveQuestion = async (questionId: string) => {
    if (!activeAssessment) return;
    try {
      await apiFetch(`/assessments/${activeAssessment.id}/questions/${questionId}`, {
        method: 'DELETE',
      });
      await refreshActive(activeAssessment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to remove question');
    }
  };

  const handleMoveQuestion = async (index: number, direction: 'up' | 'down') => {
    if (!activeAssessment) return;
    const sorted = [...activeAssessment.questions].sort((a, b) => a.orderIndex - b.orderIndex);
    const swap = direction === 'up' ? index - 1 : index + 1;
    if (swap < 0 || swap >= sorted.length) return;

    const ids = sorted.map((q) => q.questionId);
    [ids[index], ids[swap]] = [ids[swap]!, ids[index]!];

    try {
      await apiFetch(`/assessments/${activeAssessment.id}/reorder`, {
        method: 'POST',
        body: JSON.stringify({ questionIds: ids }),
      });
      await refreshActive(activeAssessment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to reorder');
    }
  };

  const handleUpdateQuestionMeta = async (
    questionId: string,
    patch: { points?: number; section?: string },
  ) => {
    if (!activeAssessment) return;
    try {
      await apiFetch(`/assessments/${activeAssessment.id}/questions/${questionId}`, {
        method: 'PATCH',
        body: JSON.stringify(patch),
      });
      await refreshActive(activeAssessment.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to update question');
    }
  };

  /* ================================================================ */
  /*  Derived / memos                                                 */
  /* ================================================================ */

  const addedQuestionIds = useMemo(
    () => new Set(activeAssessment?.questions.map((q) => q.questionId) ?? []),
    [activeAssessment],
  );

  const filteredBank = useMemo(() => {
    let list = bankQuestions;
    if (bankSearch) {
      const term = bankSearch.toLowerCase();
      list = list.filter((q) => q.prompt.toLowerCase().includes(term));
    }
    if (bankTypeFilter) {
      list = list.filter((q) => q.type === bankTypeFilter);
    }
    return list;
  }, [bankQuestions, bankSearch, bankTypeFilter]);

  const bankTypes = useMemo(
    () => Array.from(new Set(bankQuestions.map((q) => q.type))).sort(),
    [bankQuestions],
  );

  /* ================================================================ */
  /*  Render helpers                                                  */
  /* ================================================================ */

  const modeBadge = (mode: string) => (
    <span
      className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
        mode === 'test' ? 'bg-red-100 text-red-700' : 'bg-blue-100 text-blue-700'
      }`}
    >
      {mode === 'test' ? 'Test' : 'Practice'}
    </span>
  );

  const publishBadge = (published: boolean) => (
    <span
      className={`text-xs font-medium px-2 py-0.5 rounded-full ${
        published ? 'bg-green-100 text-green-800' : 'bg-yellow-100 text-yellow-800'
      }`}
    >
      {published ? 'Published' : 'Draft'}
    </span>
  );

  /* ================================================================ */
  /*  Loading / error                                                 */
  /* ================================================================ */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20 text-gray-500">
        Loading assessments...
      </div>
    );
  }

  /* ================================================================ */
  /*  VIEW: Create form                                               */
  /* ================================================================ */

  if (view === 'create') {
    return (
      <div className="max-w-2xl mx-auto">
        <button
          onClick={() => {
            resetCreateForm();
            setView('list');
          }}
          className="mb-4 text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
        >
          &larr; Back to assessments
        </button>

        <h2 className="text-2xl font-bold text-gray-900 mb-6">Create Assessment</h2>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        <form
          onSubmit={handleCreate}
          className="space-y-5 bg-white p-6 rounded-xl shadow-sm border border-gray-200"
        >
          {/* Course */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
            <select
              value={createCourseId}
              onChange={(e) => setCreateCourseId(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              <option value="">Select a course</option>
              {courses.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          </div>

          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Title</label>
            <input
              type="text"
              value={createTitle}
              onChange={(e) => setCreateTitle(e.target.value)}
              required
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="e.g. Midterm Exam"
            />
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Description (optional)
            </label>
            <textarea
              value={createDesc}
              onChange={(e) => setCreateDesc(e.target.value)}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              placeholder="Brief description of this assessment..."
            />
          </div>

          {/* Mode */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Mode</label>
            <div className="flex gap-4">
              {(['practice', 'test'] as const).map((m) => (
                <label key={m} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    name="mode"
                    checked={createMode === m}
                    onChange={() => setCreateMode(m)}
                    className="text-blue-600 focus:ring-blue-500"
                  />
                  <span className="text-sm capitalize">{m}</span>
                </label>
              ))}
            </div>
          </div>

          {/* Settings */}
          <fieldset className="border border-gray-200 rounded-lg p-4 space-y-4">
            <legend className="text-sm font-medium text-gray-700 px-1">Settings</legend>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Time Limit (minutes)</label>
                <input
                  type="number"
                  min={0}
                  value={createTimeLimit}
                  onChange={(e) => setCreateTimeLimit(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  placeholder="No limit"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Max Attempts</label>
                <input
                  type="number"
                  min={1}
                  value={createMaxAttempts}
                  onChange={(e) => setCreateMaxAttempts(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 text-sm"
                  placeholder="Unlimited"
                />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createShowSolutions}
                  onChange={(e) => setCreateShowSolutions(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Show solutions after submission</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={createShuffle}
                  onChange={(e) => setCreateShuffle(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Shuffle questions</span>
              </label>
            </div>
          </fieldset>

          {/* Submit */}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => {
                resetCreateForm();
                setView('list');
              }}
              className="px-4 py-2 text-sm text-gray-600 hover:text-gray-900 border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={creating || !createCourseId || !createTitle.trim()}
              className="px-5 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {creating ? 'Creating...' : 'Create Assessment'}
            </button>
          </div>
        </form>
      </div>
    );
  }

  /* ================================================================ */
  /*  VIEW: Builder                                                   */
  /* ================================================================ */

  if (view === 'builder' && activeAssessment) {
    const sortedQuestions = [...activeAssessment.questions].sort(
      (a, b) => a.orderIndex - b.orderIndex,
    );

    return (
      <div>
        {/* Top bar */}
        <div className="flex items-center justify-between mb-5">
          <button
            onClick={() => {
              setActiveAssessment(null);
              setView('list');
            }}
            className="text-sm text-gray-500 hover:text-gray-800 flex items-center gap-1"
          >
            &larr; Back to assessments
          </button>
          <div className="flex items-center gap-3">
            <button
              onClick={() => setShowSettings(!showSettings)}
              className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg hover:bg-gray-50"
            >
              Settings
            </button>
            <button
              onClick={() => handlePublishToggle(activeAssessment)}
              className={`px-3 py-1.5 text-sm rounded-lg transition-colors ${
                activeAssessment.isPublished
                  ? 'bg-yellow-100 text-yellow-800 hover:bg-yellow-200'
                  : 'bg-green-100 text-green-800 hover:bg-green-200'
              }`}
            >
              {activeAssessment.isPublished ? 'Unpublish' : 'Publish'}
            </button>
          </div>
        </div>

        {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

        {/* Settings panel (collapsible) */}
        {showSettings && (
          <div className="mb-5 bg-white p-5 rounded-xl shadow-sm border border-gray-200 space-y-4">
            <h3 className="font-semibold text-gray-900">Assessment Settings</h3>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Title</label>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Mode</label>
                <select
                  value={editMode}
                  onChange={(e) => setEditMode(e.target.value as 'practice' | 'test')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="practice">Practice</option>
                  <option value="test">Test</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs text-gray-500 mb-1">Description</label>
              <textarea
                value={editDesc}
                onChange={(e) => setEditDesc(e.target.value)}
                rows={2}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Time Limit (minutes)</label>
                <input
                  type="number"
                  min={0}
                  value={editTimeLimit}
                  onChange={(e) => setEditTimeLimit(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="No limit"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Max Attempts</label>
                <input
                  type="number"
                  min={1}
                  value={editMaxAttempts}
                  onChange={(e) => setEditMaxAttempts(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Unlimited"
                />
              </div>
            </div>

            <div className="flex items-center gap-6">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editShowSolutions}
                  onChange={(e) => setEditShowSolutions(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Show solutions</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={editShuffle}
                  onChange={(e) => setEditShuffle(e.target.checked)}
                  className="rounded text-blue-600 focus:ring-blue-500"
                />
                <span className="text-sm text-gray-700">Shuffle questions</span>
              </label>
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setShowSettings(false)}
                className="px-3 py-1.5 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={savingSettings}
                onClick={handleSaveSettings}
                className="px-4 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {savingSettings ? 'Saving...' : 'Save Settings'}
              </button>
            </div>
          </div>
        )}

        {/* Two-column layout */}
        <div className="grid grid-cols-1 lg:grid-cols-5 gap-5">
          {/* LEFT: assessment info + question list */}
          <div className="lg:col-span-3 space-y-4">
            {/* Info header */}
            <div className="bg-white p-4 rounded-xl shadow-sm border border-gray-200">
              <div className="flex items-center gap-2 mb-1">
                <h2 className="text-xl font-bold text-gray-900">{activeAssessment.title}</h2>
                {modeBadge(activeAssessment.mode)}
                {publishBadge(activeAssessment.isPublished)}
              </div>
              {activeAssessment.description && (
                <p className="text-sm text-gray-600 mb-2">{activeAssessment.description}</p>
              )}
              <div className="flex items-center gap-4 text-xs text-gray-500">
                <span>Course: {activeAssessment.course.title}</span>
                <span>
                  {sortedQuestions.length} question{sortedQuestions.length !== 1 ? 's' : ''}
                </span>
                <span>{totalPoints(sortedQuestions)} pts total</span>
                {activeAssessment.settings.timeLimit && (
                  <span>{activeAssessment.settings.timeLimit} min</span>
                )}
              </div>
            </div>

            {/* Question list */}
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 divide-y divide-gray-100">
              {sortedQuestions.length === 0 ? (
                <div className="p-8 text-center text-gray-400 text-sm">
                  No questions yet. Add questions from the bank on the right.
                </div>
              ) : (
                sortedQuestions.map((aq, idx) => (
                  <div key={aq.id} className="flex items-start gap-3 p-4 hover:bg-gray-50/60">
                    {/* Move buttons */}
                    <div className="flex flex-col gap-0.5 pt-1">
                      <button
                        disabled={idx === 0}
                        onClick={() => handleMoveQuestion(idx, 'up')}
                        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                        title="Move up"
                      >
                        &#9650;
                      </button>
                      <button
                        disabled={idx === sortedQuestions.length - 1}
                        onClick={() => handleMoveQuestion(idx, 'down')}
                        className="w-6 h-6 flex items-center justify-center rounded text-gray-400 hover:text-gray-700 hover:bg-gray-200 disabled:opacity-30 disabled:cursor-not-allowed text-xs"
                        title="Move down"
                      >
                        &#9660;
                      </button>
                    </div>

                    {/* Question content */}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-gray-400">Q{idx + 1}</span>
                        <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                          {aq.question.type}
                        </span>
                      </div>
                      <p className="text-sm text-gray-800 leading-snug truncate">
                        {aq.question.prompt}
                      </p>

                      {/* Points and section row */}
                      <div className="flex items-center gap-3 mt-2">
                        <label className="flex items-center gap-1 text-xs text-gray-500">
                          Points:
                          <input
                            type="number"
                            min={0}
                            defaultValue={aq.points}
                            className="w-16 px-1.5 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            onBlur={(e) => {
                              const v = Number(e.target.value);
                              if (v !== aq.points) {
                                handleUpdateQuestionMeta(aq.questionId, { points: v });
                              }
                            }}
                          />
                        </label>
                        <label className="flex items-center gap-1 text-xs text-gray-500">
                          Section:
                          <input
                            type="text"
                            defaultValue={aq.section ?? ''}
                            placeholder="none"
                            className="w-24 px-1.5 py-1 border border-gray-300 rounded text-xs focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                            onBlur={(e) => {
                              const v = e.target.value.trim();
                              if (v !== (aq.section ?? '')) {
                                handleUpdateQuestionMeta(aq.questionId, { section: v });
                              }
                            }}
                          />
                        </label>
                      </div>
                    </div>

                    {/* Remove button */}
                    <button
                      onClick={() => handleRemoveQuestion(aq.questionId)}
                      className="mt-1 p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                      title="Remove question"
                    >
                      <svg
                        className="w-4 h-4"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M6 18L18 6M6 6l12 12"
                        />
                      </svg>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* RIGHT: question bank */}
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border border-gray-200 sticky top-4">
              <div className="p-4 border-b border-gray-100">
                <h3 className="font-semibold text-gray-900 text-sm mb-3">Add from Question Bank</h3>
                <input
                  type="text"
                  value={bankSearch}
                  onChange={(e) => setBankSearch(e.target.value)}
                  placeholder="Search questions..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500 mb-2"
                />
                {bankTypes.length > 1 && (
                  <select
                    value={bankTypeFilter}
                    onChange={(e) => setBankTypeFilter(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">All types</option>
                    {bankTypes.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              <div className="max-h-[calc(100vh-16rem)] overflow-y-auto divide-y divide-gray-50">
                {bankLoading ? (
                  <div className="p-6 text-center text-gray-400 text-sm">Loading questions...</div>
                ) : filteredBank.length === 0 ? (
                  <div className="p-6 text-center text-gray-400 text-sm">No questions found.</div>
                ) : (
                  filteredBank.map((q) => {
                    const alreadyAdded = addedQuestionIds.has(q.id);
                    return (
                      <div
                        key={q.id}
                        className={`p-3 flex items-start gap-2 ${
                          alreadyAdded
                            ? 'bg-gray-50 opacity-60'
                            : 'hover:bg-blue-50/50 cursor-pointer'
                        }`}
                        onClick={() => !alreadyAdded && handleAddQuestion(q.id)}
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs bg-gray-100 text-gray-600 px-1.5 py-0.5 rounded">
                              {q.type}
                            </span>
                            <span className="text-xs text-gray-400">{q.maxScore} pts</span>
                          </div>
                          <p className="text-sm text-gray-700 truncate">{q.prompt}</p>
                        </div>
                        {alreadyAdded ? (
                          <span className="text-xs text-green-600 font-medium whitespace-nowrap mt-1">
                            Added
                          </span>
                        ) : (
                          <span
                            className="text-blue-500 mt-1 text-lg leading-none"
                            title="Add question"
                          >
                            +
                          </span>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  /* ================================================================ */
  /*  VIEW: List (default)                                            */
  /* ================================================================ */

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Assessments</h2>
        <button
          onClick={() => {
            resetCreateForm();
            setError(null);
            setView('create');
          }}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
        >
          + Create Assessment
        </button>
      </div>

      {error && <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">{error}</div>}

      {assessments.length === 0 ? (
        <div className="text-center py-16 text-gray-400">
          <p className="text-lg mb-2">No assessments yet</p>
          <p className="text-sm">Create your first assessment to get started.</p>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {assessments.map((a) => (
            <div
              key={a.id}
              className="bg-white rounded-xl shadow-sm border border-gray-200 p-5 flex flex-col justify-between hover:shadow-md transition-shadow"
            >
              {/* Card top */}
              <div>
                <div className="flex items-center gap-2 mb-2 flex-wrap">
                  <h3
                    className="text-base font-semibold text-gray-900 cursor-pointer hover:text-blue-600 transition-colors"
                    onClick={() => openBuilder(a)}
                  >
                    {a.title}
                  </h3>
                  {modeBadge(a.mode)}
                  {publishBadge(a.isPublished)}
                </div>
                {a.description && (
                  <p className="text-sm text-gray-500 mb-2 line-clamp-2">{a.description}</p>
                )}
                <div className="flex items-center gap-3 text-xs text-gray-400 mb-4">
                  <span>{a.course.title}</span>
                  <span>
                    {a.questions.length} question{a.questions.length !== 1 ? 's' : ''}
                  </span>
                  <span>{formatDate(a.createdAt)}</span>
                </div>
              </div>

              {/* Card actions */}
              <div className="flex items-center gap-2 pt-3 border-t border-gray-100">
                <button
                  onClick={() => openBuilder(a)}
                  className="flex-1 px-3 py-1.5 text-sm text-blue-600 border border-blue-200 rounded-lg hover:bg-blue-50 transition-colors"
                >
                  Edit
                </button>
                <button
                  onClick={() => handlePublishToggle(a)}
                  className={`flex-1 px-3 py-1.5 text-sm rounded-lg transition-colors ${
                    a.isPublished
                      ? 'text-yellow-700 border border-yellow-200 hover:bg-yellow-50'
                      : 'text-green-700 border border-green-200 hover:bg-green-50'
                  }`}
                >
                  {a.isPublished ? 'Unpublish' : 'Publish'}
                </button>
                <button
                  onClick={() => setDeleteTarget(a.id)}
                  className="px-3 py-1.5 text-sm text-red-500 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
                  title="Delete"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
                    />
                  </svg>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-sm w-full mx-4">
            <h3 className="text-lg font-semibold text-gray-900 mb-2">Delete Assessment</h3>
            <p className="text-sm text-gray-600 mb-5">
              Are you sure you want to delete this assessment? This action cannot be undone.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setDeleteTarget(null)}
                className="px-4 py-2 text-sm text-gray-600 border border-gray-300 rounded-lg hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                onClick={() => handleDelete(deleteTarget)}
                className="px-4 py-2 text-sm bg-red-600 text-white rounded-lg hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
