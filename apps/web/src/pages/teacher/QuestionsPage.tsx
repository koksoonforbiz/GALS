import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiFetch } from '../../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

type QuestionType = 'text' | 'MCQ_SINGLE' | 'MCQ_MULTI' | 'STRUCTURED';
type BloomsLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
type QuestionStatus = 'draft' | 'approved' | 'archived';

interface McqOption {
  id: string;
  text: string;
  isCorrect: boolean;
}

interface Question {
  id: string;
  courseId: string;
  topicId: string;
  prompt: string;
  stem: unknown;
  type: QuestionType;
  maxScore: number;
  rubricJson: Record<string, unknown> | null;
  options: McqOption[] | null;
  correctOptionId: string | null;
  correctAnswer: string | null;
  explanation: string | null;
  difficulty: number;
  bloomsLevel: BloomsLevel | null;
  kcIds: string[];
  pageIds: string[];
  tags: string[] | null;
  status: QuestionStatus;
  createdBy: string | null;
  sourceType: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
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

interface EditorState {
  courseId: string;
  topicId: string;
  type: QuestionType;
  prompt: string;
  maxScore: number;
  difficulty: number;
  bloomsLevel: BloomsLevel | '';
  status: QuestionStatus;
  options: McqOption[];
  rubricJson: string;
  tags: string;
  explanation: string;
}

const QUESTION_TYPES: { value: QuestionType; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'MCQ_SINGLE', label: 'MCQ (Single)' },
  { value: 'MCQ_MULTI', label: 'MCQ (Multi)' },
  { value: 'STRUCTURED', label: 'Structured' },
];

const BLOOMS_LEVELS: { value: BloomsLevel; label: string }[] = [
  { value: 'remember', label: 'Remember' },
  { value: 'understand', label: 'Understand' },
  { value: 'apply', label: 'Apply' },
  { value: 'analyze', label: 'Analyze' },
  { value: 'evaluate', label: 'Evaluate' },
  { value: 'create', label: 'Create' },
];

const STATUSES: { value: QuestionStatus; label: string }[] = [
  { value: 'draft', label: 'Draft' },
  { value: 'approved', label: 'Approved' },
  { value: 'archived', label: 'Archived' },
];

const EMPTY_EDITOR: EditorState = {
  courseId: '',
  topicId: '',
  type: 'text',
  prompt: '',
  maxScore: 10,
  difficulty: 3,
  bloomsLevel: '',
  status: 'draft',
  options: [],
  rubricJson: '{}',
  tags: '',
  explanation: '',
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function uid(): string {
  return Math.random().toString(36).slice(2, 10);
}

const TYPE_COLORS: Record<QuestionType, string> = {
  text: 'bg-blue-100 text-blue-800',
  MCQ_SINGLE: 'bg-amber-100 text-amber-800',
  MCQ_MULTI: 'bg-orange-100 text-orange-800',
  STRUCTURED: 'bg-teal-100 text-teal-800',
};

const STATUS_COLORS: Record<QuestionStatus, string> = {
  draft: 'bg-gray-100 text-gray-700',
  approved: 'bg-emerald-100 text-emerald-700',
  archived: 'bg-red-100 text-red-700',
};

const BLOOMS_COLORS: Record<BloomsLevel, string> = {
  remember: 'bg-sky-100 text-sky-800',
  understand: 'bg-indigo-100 text-indigo-800',
  apply: 'bg-violet-100 text-violet-800',
  analyze: 'bg-fuchsia-100 text-fuchsia-800',
  evaluate: 'bg-rose-100 text-rose-800',
  create: 'bg-pink-100 text-pink-800',
};

function isMcq(t: QuestionType) {
  return t === 'MCQ_SINGLE' || t === 'MCQ_MULTI';
}

function DifficultyStars({ value }: { value: number }) {
  return (
    <span className="inline-flex gap-0.5" title={`Difficulty ${value}/5`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <svg
          key={n}
          className={`w-3.5 h-3.5 ${n <= value ? 'text-yellow-400' : 'text-gray-300'}`}
          fill="currentColor"
          viewBox="0 0 20 20"
        >
          <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.286 3.957a1 1 0 00.95.69h4.162c.969 0 1.371 1.24.588 1.81l-3.37 2.448a1 1 0 00-.364 1.118l1.287 3.957c.3.921-.755 1.688-1.54 1.118l-3.37-2.448a1 1 0 00-1.176 0l-3.37 2.448c-.784.57-1.838-.197-1.539-1.118l1.287-3.957a1 1 0 00-.364-1.118L2.063 9.384c-.783-.57-.38-1.81.588-1.81h4.162a1 1 0 00.95-.69l1.286-3.957z" />
        </svg>
      ))}
    </span>
  );
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function QuestionsPage() {
  /* ---- data ---- */
  const [questions, setQuestions] = useState<Question[]>([]);
  const [courses, setCourses] = useState<Course[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  /* ---- filters ---- */
  const [filterCourse, setFilterCourse] = useState('');
  const [filterType, setFilterType] = useState('');
  const [filterStatus, setFilterStatus] = useState('');
  const [filterDifficulty, setFilterDifficulty] = useState('');
  const [filterBlooms, setFilterBlooms] = useState('');
  const [search, setSearch] = useState('');

  /* ---- selection ---- */
  const [selected, setSelected] = useState<Set<string>>(new Set());

  /* ---- editor drawer ---- */
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editor, setEditor] = useState<EditorState>({ ...EMPTY_EDITOR });
  const [saving, setSaving] = useState(false);

  /* ---- bulk import ---- */
  const [importOpen, setImportOpen] = useState(false);
  const [importCourseId, setImportCourseId] = useState('');
  const [importText, setImportText] = useState('');
  const [importing, setImporting] = useState(false);

  /* ---- card menu ---- */
  const [menuOpenId, setMenuOpenId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  /* ---- bulk status modal ---- */
  const [bulkStatusOpen, setBulkStatusOpen] = useState(false);
  const [bulkStatusValue, setBulkStatusValue] = useState<QuestionStatus>('draft');

  /* ---------------------------------------------------------------- */
  /*  Fetch helpers                                                    */
  /* ---------------------------------------------------------------- */

  const buildQueryString = useCallback(() => {
    const params = new URLSearchParams();
    if (filterCourse) params.set('courseId', filterCourse);
    if (filterType) params.set('type', filterType);
    if (filterStatus) params.set('status', filterStatus);
    if (filterDifficulty) params.set('difficulty', filterDifficulty);
    if (filterBlooms) params.set('bloomsLevel', filterBlooms);
    if (search.trim()) params.set('search', search.trim());
    const qs = params.toString();
    return qs ? `?${qs}` : '';
  }, [filterCourse, filterType, filterStatus, filterDifficulty, filterBlooms, search]);

  const fetchQuestions = useCallback(async () => {
    try {
      const data = await apiFetch<Question[]>(`/questions${buildQueryString()}`);
      setQuestions(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load questions');
    }
  }, [buildQueryString]);

  const fetchCourses = useCallback(async () => {
    try {
      const data = await apiFetch<Course[]>('/courses');
      setCourses(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load courses');
    }
  }, []);

  /* initial load */
  useEffect(() => {
    (async () => {
      setLoading(true);
      await Promise.all([fetchQuestions(), fetchCourses()]);
      setLoading(false);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* refetch when filters change */
  useEffect(() => {
    if (!loading) {
      fetchQuestions();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterCourse, filterType, filterStatus, filterDifficulty, filterBlooms, search]);

  /* close menu on outside click */
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpenId(null);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  /* ---------------------------------------------------------------- */
  /*  Derived                                                          */
  /* ---------------------------------------------------------------- */

  const courseMap = useMemo(() => {
    const m: Record<string, Course> = {};
    courses.forEach((c) => (m[c.id] = c));
    return m;
  }, [courses]);

  const topicsForCourse = useMemo(() => {
    if (!editor.courseId) return [];
    return courseMap[editor.courseId]?.topics ?? [];
  }, [editor.courseId, courseMap]);

  const allSelected = questions.length > 0 && selected.size === questions.length;

  /* ---------------------------------------------------------------- */
  /*  Selection                                                        */
  /* ---------------------------------------------------------------- */

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (allSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(questions.map((q) => q.id)));
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Editor                                                           */
  /* ---------------------------------------------------------------- */

  function openCreate() {
    setEditingId(null);
    setEditor({ ...EMPTY_EDITOR });
    setDrawerOpen(true);
  }

  function openEdit(q: Question) {
    setEditingId(q.id);
    setEditor({
      courseId: q.courseId ?? '',
      topicId: q.topicId ?? '',
      type: q.type,
      prompt: q.prompt ?? '',
      maxScore: q.maxScore,
      difficulty: q.difficulty ?? 3,
      bloomsLevel: q.bloomsLevel ?? '',
      status: q.status,
      options: q.options?.length ? q.options : [],
      rubricJson: q.rubricJson ? JSON.stringify(q.rubricJson, null, 2) : '{}',
      tags: Array.isArray(q.tags) ? q.tags.join(', ') : '',
      explanation: q.explanation ?? '',
    });
    setDrawerOpen(true);
    setMenuOpenId(null);
  }

  function closeDrawer() {
    setDrawerOpen(false);
    setEditingId(null);
  }

  function updateEditor<K extends keyof EditorState>(key: K, value: EditorState[K]) {
    setEditor((prev) => ({ ...prev, [key]: value }));
  }

  /* MCQ options helpers */
  function addOption() {
    updateEditor('options', [...editor.options, { id: uid(), text: '', isCorrect: false }]);
  }

  function removeOption(id: string) {
    updateEditor(
      'options',
      editor.options.filter((o) => o.id !== id),
    );
  }

  function setOptionText(id: string, text: string) {
    updateEditor(
      'options',
      editor.options.map((o) => (o.id === id ? { ...o, text } : o)),
    );
  }

  function toggleOptionCorrect(id: string) {
    if (editor.type === 'MCQ_SINGLE') {
      updateEditor(
        'options',
        editor.options.map((o) => ({ ...o, isCorrect: o.id === id })),
      );
    } else {
      updateEditor(
        'options',
        editor.options.map((o) => (o.id === id ? { ...o, isCorrect: !o.isCorrect } : o)),
      );
    }
  }

  async function handleSave() {
    setSaving(true);
    setError(null);
    try {
      let parsedRubric: unknown = {};
      try {
        parsedRubric = JSON.parse(editor.rubricJson);
      } catch {
        /* keep empty object */
      }

      const parsedTags = editor.tags
        .split(',')
        .map((t) => t.trim())
        .filter(Boolean);

      const body: Record<string, unknown> = {
        courseId: editor.courseId || undefined,
        topicId: editor.topicId || undefined,
        type: editor.type,
        prompt: editor.prompt,
        maxScore: editor.maxScore,
        difficulty: editor.difficulty,
        bloomsLevel: editor.bloomsLevel || undefined,
        status: editor.status,
        rubricJson: parsedRubric,
        tags: parsedTags.length ? parsedTags : undefined,
        explanation: editor.explanation || undefined,
      };

      if (isMcq(editor.type) && editor.options.length) {
        body.options = editor.options;
      }

      if (editingId) {
        await apiFetch(`/questions/${editingId}`, {
          method: 'PATCH',
          body: JSON.stringify(body),
        });
      } else {
        await apiFetch('/questions', {
          method: 'POST',
          body: JSON.stringify(body),
        });
      }

      closeDrawer();
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Card actions                                                     */
  /* ---------------------------------------------------------------- */

  async function handleDuplicate(id: string) {
    setMenuOpenId(null);
    try {
      await apiFetch(`/questions/${id}/duplicate`, { method: 'POST' });
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Duplicate failed');
    }
  }

  async function handleArchive(id: string) {
    setMenuOpenId(null);
    try {
      await apiFetch(`/questions/${id}/archive`, { method: 'POST' });
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Archive failed');
    }
  }

  async function handleDelete(id: string) {
    setMenuOpenId(null);
    if (!window.confirm('Delete this question permanently?')) return;
    try {
      await apiFetch(`/questions/${id}`, { method: 'DELETE' });
      setSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Delete failed');
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Bulk actions                                                     */
  /* ---------------------------------------------------------------- */

  async function handleBulkStatus() {
    setBulkStatusOpen(false);
    try {
      await apiFetch('/questions/bulk-status', {
        method: 'POST',
        body: JSON.stringify({ ids: Array.from(selected), status: bulkStatusValue }),
      });
      setSelected(new Set());
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk status change failed');
    }
  }

  async function handleBulkArchive() {
    if (!window.confirm(`Archive ${selected.size} selected questions?`)) return;
    try {
      await Promise.all(
        Array.from(selected).map((id) => apiFetch(`/questions/${id}/archive`, { method: 'POST' })),
      );
      setSelected(new Set());
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk archive failed');
    }
  }

  async function handleBulkDelete() {
    if (!window.confirm(`Delete ${selected.size} selected questions permanently?`)) return;
    try {
      await Promise.all(
        Array.from(selected).map((id) => apiFetch(`/questions/${id}`, { method: 'DELETE' })),
      );
      setSelected(new Set());
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bulk delete failed');
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Bulk Import                                                      */
  /* ---------------------------------------------------------------- */

  async function handleBulkImport() {
    if (!importCourseId || !importText.trim()) return;
    setImporting(true);
    setError(null);
    try {
      let parsed: unknown[];
      const trimmed = importText.trim();
      if (trimmed.startsWith('[')) {
        parsed = JSON.parse(trimmed);
      } else {
        /* simple CSV: each line is prompt,type,maxScore,difficulty */
        parsed = trimmed
          .split('\n')
          .filter((l) => l.trim())
          .map((line) => {
            const [prompt, type, maxScore, difficulty] = line.split(',').map((s) => s.trim());
            return {
              prompt,
              type: type || 'text',
              maxScore: Number(maxScore) || 10,
              difficulty: Number(difficulty) || 3,
            };
          });
      }
      await apiFetch('/questions/bulk-import', {
        method: 'POST',
        body: JSON.stringify({ courseId: importCourseId, questions: parsed }),
      });
      setImportOpen(false);
      setImportText('');
      setImportCourseId('');
      await fetchQuestions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Import failed');
    } finally {
      setImporting(false);
    }
  }

  /* ---------------------------------------------------------------- */
  /*  Render                                                           */
  /* ---------------------------------------------------------------- */

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <svg className="animate-spin h-8 w-8 text-blue-600" fill="none" viewBox="0 0 24 24">
          <circle
            className="opacity-25"
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="4"
          />
          <path
            className="opacity-75"
            fill="currentColor"
            d="M4 12a8 8 0 018-8v4a4 4 0 00-4 4H4z"
          />
        </svg>
        <span className="ml-3 text-gray-500 text-lg">Loading question bank...</span>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto">
      {/* ---------- HEADER ---------- */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Question Bank</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setImportOpen(true)}
            className="px-4 py-2 border border-gray-300 bg-white text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
          >
            Bulk Import
          </button>
          <button
            onClick={openCreate}
            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
          >
            + Create Question
          </button>
        </div>
      </div>

      {/* ---------- ERROR ---------- */}
      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg flex items-center justify-between">
          <span className="text-sm">{error}</span>
          <button onClick={() => setError(null)} className="text-red-400 hover:text-red-600 ml-4">
            &times;
          </button>
        </div>
      )}

      {/* ---------- FILTER BAR ---------- */}
      <div className="bg-white rounded-lg shadow-sm border border-gray-200 p-4 mb-4">
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {/* Course */}
          <select
            value={filterCourse}
            onChange={(e) => setFilterCourse(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Courses</option>
            {courses.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>

          {/* Type */}
          <select
            value={filterType}
            onChange={(e) => setFilterType(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Types</option>
            {QUESTION_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>

          {/* Status */}
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Statuses</option>
            {STATUSES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          {/* Difficulty */}
          <select
            value={filterDifficulty}
            onChange={(e) => setFilterDifficulty(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Difficulties</option>
            {[1, 2, 3, 4, 5].map((d) => (
              <option key={d} value={d}>
                {'*'.repeat(d)} ({d})
              </option>
            ))}
          </select>

          {/* Bloom's */}
          <select
            value={filterBlooms}
            onChange={(e) => setFilterBlooms(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          >
            <option value="">All Bloom's</option>
            {BLOOMS_LEVELS.map((b) => (
              <option key={b.value} value={b.value}>
                {b.label}
              </option>
            ))}
          </select>

          {/* Search */}
          <input
            type="text"
            placeholder="Search questions..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
          />
        </div>
      </div>

      {/* ---------- BULK ACTION BAR ---------- */}
      {selected.size > 0 && (
        <div className="bg-blue-50 border border-blue-200 rounded-lg p-3 mb-4 flex flex-wrap items-center gap-3">
          <span className="text-sm font-medium text-blue-800">{selected.size} selected</span>
          <button
            onClick={() => {
              setBulkStatusValue('draft');
              setBulkStatusOpen(true);
            }}
            className="px-3 py-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors"
          >
            Change Status
          </button>
          <button
            onClick={handleBulkArchive}
            className="px-3 py-1.5 bg-white border border-blue-300 text-blue-700 rounded-lg text-sm hover:bg-blue-100 transition-colors"
          >
            Archive
          </button>
          <button
            onClick={handleBulkDelete}
            className="px-3 py-1.5 bg-red-600 text-white rounded-lg text-sm hover:bg-red-700 transition-colors"
          >
            Delete
          </button>
          <button
            onClick={() => setSelected(new Set())}
            className="ml-auto text-sm text-blue-600 hover:underline"
          >
            Clear selection
          </button>
        </div>
      )}

      {/* ---------- SELECT ALL ---------- */}
      {questions.length > 0 && (
        <div className="flex items-center gap-2 mb-3 px-1">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={toggleSelectAll}
            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
          />
          <span className="text-sm text-gray-500">
            Select all ({questions.length} question{questions.length !== 1 ? 's' : ''})
          </span>
        </div>
      )}

      {/* ---------- QUESTION LIST ---------- */}
      <div className="space-y-3">
        {questions.length === 0 ? (
          <div className="text-center py-16 bg-white rounded-lg border border-gray-200">
            <svg
              className="mx-auto h-12 w-12 text-gray-300"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1.5}
                d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M12 21a9 9 0 100-18 9 9 0 000 18z"
              />
            </svg>
            <p className="mt-3 text-gray-500">
              No questions found. Create your first question or adjust your filters.
            </p>
          </div>
        ) : (
          questions.map((q) => {
            const course = courseMap[q.courseId];
            return (
              <div
                key={q.id}
                className={`bg-white rounded-lg shadow-sm border p-4 transition-colors ${
                  selected.has(q.id) ? 'border-blue-400 ring-1 ring-blue-200' : 'border-gray-200'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Checkbox */}
                  <input
                    type="checkbox"
                    checked={selected.has(q.id)}
                    onChange={() => toggleSelect(q.id)}
                    className="mt-1 h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 shrink-0"
                  />

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    {/* Badges row */}
                    <div className="flex flex-wrap items-center gap-2 mb-2">
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${TYPE_COLORS[q.type] || 'bg-gray-100 text-gray-700'}`}
                      >
                        {QUESTION_TYPES.find((t) => t.value === q.type)?.label ?? q.type}
                      </span>
                      <span
                        className={`text-xs px-2 py-0.5 rounded-full font-medium ${STATUS_COLORS[q.status] || 'bg-gray-100 text-gray-700'}`}
                      >
                        {q.status}
                      </span>
                      <DifficultyStars value={q.difficulty ?? 0} />
                      {q.bloomsLevel && (
                        <span
                          className={`text-xs px-2 py-0.5 rounded-full font-medium ${BLOOMS_COLORS[q.bloomsLevel] || 'bg-gray-100 text-gray-700'}`}
                        >
                          {q.bloomsLevel}
                        </span>
                      )}
                      {course && <span className="text-xs text-gray-500">{course.title}</span>}
                      <span className="text-xs text-gray-400 ml-auto shrink-0">
                        v{q.version} | {q.maxScore} pts
                      </span>
                    </div>

                    {/* Prompt preview */}
                    <p className="text-sm text-gray-700 line-clamp-2 whitespace-pre-wrap">
                      {q.prompt ? q.prompt.substring(0, 250) : '(no prompt)'}
                      {q.prompt && q.prompt.length > 250 ? '...' : ''}
                    </p>
                  </div>

                  {/* 3-dot menu */}
                  <div
                    className="relative shrink-0"
                    ref={menuOpenId === q.id ? menuRef : undefined}
                  >
                    <button
                      onClick={() => setMenuOpenId(menuOpenId === q.id ? null : q.id)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                    >
                      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                        <path d="M10 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4zm0 6a2 2 0 110-4 2 2 0 010 4z" />
                      </svg>
                    </button>
                    {menuOpenId === q.id && (
                      <div className="absolute right-0 top-8 w-40 bg-white border border-gray-200 rounded-lg shadow-lg z-20 py-1">
                        <button
                          onClick={() => openEdit(q)}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => handleDuplicate(q.id)}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Duplicate
                        </button>
                        <button
                          onClick={() => handleArchive(q.id)}
                          className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                        >
                          Archive
                        </button>
                        <button
                          onClick={() => handleDelete(q.id)}
                          className="w-full text-left px-4 py-2 text-sm text-red-600 hover:bg-red-50"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* ============================================================ */}
      {/*  QUESTION EDITOR DRAWER                                        */}
      {/* ============================================================ */}
      {drawerOpen && (
        <div className="fixed inset-0 z-40 flex justify-end">
          {/* backdrop */}
          <div className="absolute inset-0 bg-black/30" onClick={closeDrawer} />

          {/* panel */}
          <div className="relative w-full max-w-2xl bg-white shadow-xl overflow-y-auto">
            <div className="sticky top-0 bg-white border-b border-gray-200 px-6 py-4 flex items-center justify-between z-10">
              <h3 className="text-lg font-semibold text-gray-900">
                {editingId ? 'Edit Question' : 'Create Question'}
              </h3>
              <button
                onClick={closeDrawer}
                className="text-gray-400 hover:text-gray-600 text-xl leading-none"
              >
                &times;
              </button>
            </div>

            <div className="p-6 space-y-5">
              {/* Course + Topic */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
                  <select
                    value={editor.courseId}
                    onChange={(e) => {
                      updateEditor('courseId', e.target.value);
                      updateEditor('topicId', '');
                    }}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  >
                    <option value="">Select course</option>
                    {courses.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Topic</label>
                  <select
                    value={editor.topicId}
                    onChange={(e) => updateEditor('topicId', e.target.value)}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                    disabled={!editor.courseId}
                  >
                    <option value="">Select topic</option>
                    {topicsForCourse.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              {/* Type */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Type</label>
                <div className="flex flex-wrap gap-2">
                  {QUESTION_TYPES.map((t) => (
                    <button
                      key={t.value}
                      type="button"
                      onClick={() => updateEditor('type', t.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        editor.type === t.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Prompt */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Prompt</label>
                <textarea
                  value={editor.prompt}
                  onChange={(e) => updateEditor('prompt', e.target.value)}
                  rows={6}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder="Enter question prompt..."
                />
              </div>

              {/* Max Score + Difficulty */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Max Score</label>
                  <input
                    type="number"
                    min={1}
                    value={editor.maxScore}
                    onChange={(e) => updateEditor('maxScore', Number(e.target.value))}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Difficulty: {editor.difficulty}
                  </label>
                  <input
                    type="range"
                    min={1}
                    max={5}
                    step={1}
                    value={editor.difficulty}
                    onChange={(e) => updateEditor('difficulty', Number(e.target.value))}
                    className="w-full mt-1"
                  />
                  <div className="flex justify-between text-xs text-gray-400">
                    <span>1</span>
                    <span>2</span>
                    <span>3</span>
                    <span>4</span>
                    <span>5</span>
                  </div>
                </div>
              </div>

              {/* MCQ Options */}
              {isMcq(editor.type) && (
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Options{' '}
                    {editor.type === 'MCQ_SINGLE' ? '(select one correct)' : '(select all correct)'}
                  </label>
                  <div className="space-y-2">
                    {editor.options.map((opt) => (
                      <div key={opt.id} className="flex items-center gap-2">
                        <button
                          type="button"
                          onClick={() => toggleOptionCorrect(opt.id)}
                          className={`shrink-0 w-6 h-6 rounded-full border-2 flex items-center justify-center transition-colors ${
                            opt.isCorrect
                              ? 'bg-green-500 border-green-500 text-white'
                              : 'border-gray-300 text-transparent hover:border-green-300'
                          }`}
                          title={opt.isCorrect ? 'Correct' : 'Mark as correct'}
                        >
                          <svg className="w-3.5 h-3.5" fill="currentColor" viewBox="0 0 20 20">
                            <path
                              fillRule="evenodd"
                              d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z"
                              clipRule="evenodd"
                            />
                          </svg>
                        </button>
                        <input
                          type="text"
                          value={opt.text}
                          onChange={(e) => setOptionText(opt.id, e.target.value)}
                          placeholder="Option text"
                          className="flex-1 px-3 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                        />
                        <button
                          type="button"
                          onClick={() => removeOption(opt.id)}
                          className="shrink-0 text-red-400 hover:text-red-600"
                        >
                          <svg
                            className="w-5 h-5"
                            fill="none"
                            viewBox="0 0 24 24"
                            stroke="currentColor"
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
                    ))}
                  </div>
                  <button
                    type="button"
                    onClick={addOption}
                    className="mt-2 text-sm text-blue-600 hover:text-blue-800 font-medium"
                  >
                    + Add Option
                  </button>
                </div>
              )}

              {/* Bloom's Level */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Bloom's Level
                </label>
                <select
                  value={editor.bloomsLevel}
                  onChange={(e) => updateEditor('bloomsLevel', e.target.value as BloomsLevel | '')}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">None</option>
                  {BLOOMS_LEVELS.map((b) => (
                    <option key={b.value} value={b.value}>
                      {b.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Status */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
                <div className="flex gap-2">
                  {STATUSES.map((s) => (
                    <button
                      key={s.value}
                      type="button"
                      onClick={() => updateEditor('status', s.value)}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                        editor.status === s.value
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                      }`}
                    >
                      {s.label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Tags */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Tags (comma-separated)
                </label>
                <input
                  type="text"
                  value={editor.tags}
                  onChange={(e) => updateEditor('tags', e.target.value)}
                  placeholder="algebra, quadratics, mid-term"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Explanation */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Explanation</label>
                <textarea
                  value={editor.explanation}
                  onChange={(e) => updateEditor('explanation', e.target.value)}
                  rows={3}
                  placeholder="Explanation shown after submission..."
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                />
              </div>

              {/* Rubric JSON */}
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rubric JSON</label>
                <textarea
                  value={editor.rubricJson}
                  onChange={(e) => updateEditor('rubricJson', e.target.value)}
                  rows={4}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder='{"criteria": []}'
                />
              </div>

              {/* Actions */}
              <div className="flex items-center gap-3 pt-2 border-t border-gray-200">
                <button
                  onClick={handleSave}
                  disabled={saving || !editor.prompt.trim()}
                  className="px-5 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
                >
                  {saving ? 'Saving...' : editingId ? 'Update Question' : 'Create Question'}
                </button>
                <button
                  onClick={closeDrawer}
                  className="px-5 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  BULK IMPORT MODAL                                             */}
      {/* ============================================================ */}
      {importOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setImportOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">Bulk Import Questions</h3>

            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Course</label>
                <select
                  value={importCourseId}
                  onChange={(e) => setImportCourseId(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                >
                  <option value="">Select course</option>
                  {courses.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.title}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">
                  Questions (JSON array or CSV)
                </label>
                <textarea
                  value={importText}
                  onChange={(e) => setImportText(e.target.value)}
                  rows={8}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
                  placeholder={`JSON: [{"prompt":"...","type":"text","maxScore":10}]\n\nCSV: prompt,type,maxScore,difficulty\nWhat is 2+2?,text,5,1`}
                />
              </div>

              <div className="flex items-center gap-3">
                <button
                  onClick={handleBulkImport}
                  disabled={importing || !importCourseId || !importText.trim()}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors text-sm font-medium"
                >
                  {importing ? 'Importing...' : 'Import'}
                </button>
                <button
                  onClick={() => setImportOpen(false)}
                  className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ============================================================ */}
      {/*  BULK STATUS MODAL                                             */}
      {/* ============================================================ */}
      {bulkStatusOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center">
          <div className="absolute inset-0 bg-black/30" onClick={() => setBulkStatusOpen(false)} />
          <div className="relative bg-white rounded-xl shadow-xl max-w-sm w-full mx-4 p-6">
            <h3 className="text-lg font-semibold text-gray-900 mb-4">
              Change Status ({selected.size} question{selected.size !== 1 ? 's' : ''})
            </h3>
            <select
              value={bulkStatusValue}
              onChange={(e) => setBulkStatusValue(e.target.value as QuestionStatus)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm mb-4 focus:ring-2 focus:ring-blue-500 focus:border-blue-500"
            >
              {STATUSES.map((s) => (
                <option key={s.value} value={s.value}>
                  {s.label}
                </option>
              ))}
            </select>
            <div className="flex items-center gap-3">
              <button
                onClick={handleBulkStatus}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors text-sm font-medium"
              >
                Apply
              </button>
              <button
                onClick={() => setBulkStatusOpen(false)}
                className="px-4 py-2 border border-gray-300 text-gray-700 rounded-lg hover:bg-gray-50 transition-colors text-sm font-medium"
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
