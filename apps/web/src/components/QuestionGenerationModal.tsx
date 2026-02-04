import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

interface QuestionGenerationModalProps {
  open: boolean;
  onClose: () => void;
  courseId: string;
  assessmentId?: string;
  onQuestionsGenerated?: (questionIds: string[]) => void;
}

type QuestionType = 'MCQ_SINGLE' | 'MCQ_MULTI' | 'STRUCTURED';
type Difficulty = 'easy' | 'medium' | 'hard';
type BloomsLevel = 'remember' | 'understand' | 'apply' | 'analyze' | 'evaluate' | 'create';
type SourceMode = 'lesson_based' | 'question_material' | 'mixed';
type Step = 'config' | 'generating' | 'review';

interface DifficultyDistribution {
  easy: number;
  medium: number;
  hard: number;
}

interface Option {
  text: string;
  isCorrect: boolean;
}

interface GeneratedQuestion {
  id?: string;
  type: QuestionType;
  stem: string;
  options: Option[];
  expectedAnswer?: string;
  rubric?: string;
  explanation: string;
  difficulty: Difficulty;
  bloomsLevel: BloomsLevel;
  kcTags: { id: string; name: string }[];
  selected: boolean;
}

interface ModuleItem {
  id: string;
  title: string;
  type: string;
}

interface Module {
  id: string;
  title: string;
  items: ModuleItem[];
}

interface Document {
  id: string;
  documentTitle: string;
  filename: string;
}

interface KC {
  id: string;
  name: string;
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const QUESTION_TYPE_LABELS: Record<QuestionType, string> = {
  MCQ_SINGLE: 'MCQ (Single Correct)',
  MCQ_MULTI: 'MCQ (Select All That Apply)',
  STRUCTURED: 'Structured Response',
};

const BLOOMS_LEVELS: BloomsLevel[] = [
  'remember',
  'understand',
  'apply',
  'analyze',
  'evaluate',
  'create',
];

const DIFFICULTY_LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export function QuestionGenerationModal({
  open,
  onClose,
  courseId,
  assessmentId,
  onQuestionsGenerated,
}: QuestionGenerationModalProps) {
  /* ---------- step state ---------- */
  const [step, setStep] = useState<Step>('config');
  const [error, setError] = useState<string | null>(null);

  /* ---------- config state ---------- */
  const [selectedTypes, setSelectedTypes] = useState<Set<QuestionType>>(new Set(['MCQ_SINGLE']));
  const [quantity, setQuantity] = useState(5);
  const [diffDist, setDiffDist] = useState<DifficultyDistribution>({ easy: 2, medium: 2, hard: 1 });
  const [bloomsOpen, setBloomsOpen] = useState(false);
  const [selectedBlooms, setSelectedBlooms] = useState<Set<BloomsLevel>>(new Set());
  const [sourceMode, setSourceMode] = useState<SourceMode>('lesson_based');
  const [selectedPageIds, setSelectedPageIds] = useState<string[]>([]);
  const [selectedSourceIds, setSelectedSourceIds] = useState<string[]>([]);
  const [selectedKcIds, setSelectedKcIds] = useState<string[]>([]);
  const [strictSource, setStrictSource] = useState(false);
  const [customPrompt, setCustomPrompt] = useState('');

  /* ---------- fetched data ---------- */
  const [pages, setPages] = useState<{ id: string; title: string }[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [kcs, setKcs] = useState<KC[]>([]);
  const [loadingPages, setLoadingPages] = useState(false);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [loadingKcs, setLoadingKcs] = useState(false);

  /* ---------- review state ---------- */
  const [questions, setQuestions] = useState<GeneratedQuestion[]>([]);
  const [saving, setSaving] = useState(false);

  /* ---------- reset on open ---------- */
  useEffect(() => {
    if (open) {
      setStep('config');
      setError(null);
      setQuestions([]);
    }
  }, [open]);

  /* ---------- fetch pages ---------- */
  useEffect(() => {
    if (!open || !courseId) return;
    if (sourceMode !== 'lesson_based' && sourceMode !== 'mixed') return;
    setLoadingPages(true);
    apiFetch<{ modules?: Module[] }>(`/courses/${courseId}`)
      .then((course) => {
        const pageItems: { id: string; title: string }[] = [];
        for (const mod of course.modules ?? []) {
          for (const item of mod.items ?? []) {
            if (item.type === 'PAGE') {
              pageItems.push({ id: item.id, title: `${mod.title} / ${item.title}` });
            }
          }
        }
        setPages(pageItems);
      })
      .catch(() => setPages([]))
      .finally(() => setLoadingPages(false));
  }, [open, courseId, sourceMode]);

  /* ---------- fetch documents ---------- */
  useEffect(() => {
    if (!open || !courseId) return;
    if (sourceMode !== 'question_material' && sourceMode !== 'mixed') return;
    setLoadingDocs(true);
    apiFetch<Document[]>(`/courses/${courseId}/documents`)
      .then(setDocuments)
      .catch(() => setDocuments([]))
      .finally(() => setLoadingDocs(false));
  }, [open, courseId, sourceMode]);

  /* ---------- fetch KCs ---------- */
  useEffect(() => {
    if (!open || !courseId) return;
    setLoadingKcs(true);
    apiFetch<KC[]>(`/proposed-kcs?courseId=${courseId}`)
      .then(setKcs)
      .catch(() => setKcs([]))
      .finally(() => setLoadingKcs(false));
  }, [open, courseId]);

  /* ---------- auto-distribute difficulty on quantity change ---------- */
  useEffect(() => {
    const base = Math.floor(quantity / 3);
    const remainder = quantity % 3;
    setDiffDist({
      easy: base + (remainder >= 1 ? 1 : 0),
      medium: base + (remainder >= 2 ? 1 : 0),
      hard: base,
    });
  }, [quantity]);

  /* ---------- helpers ---------- */
  const toggleType = (t: QuestionType) => {
    setSelectedTypes((prev) => {
      const next = new Set(prev);
      if (next.has(t)) next.delete(t);
      else next.add(t);
      return next;
    });
  };

  const toggleBlooms = (b: BloomsLevel) => {
    setSelectedBlooms((prev) => {
      const next = new Set(prev);
      if (next.has(b)) next.delete(b);
      else next.add(b);
      return next;
    });
  };

  const diffSum = diffDist.easy + diffDist.medium + diffDist.hard;
  const configValid =
    selectedTypes.size > 0 && quantity >= 1 && quantity <= 50 && diffSum === quantity;

  /* ---------- generate ---------- */
  const handleGenerate = async () => {
    setStep('generating');
    setError(null);
    try {
      const body = {
        courseId,
        types: Array.from(selectedTypes),
        quantity,
        difficultyDistribution: diffDist,
        bloomsLevels: selectedBlooms.size > 0 ? Array.from(selectedBlooms) : undefined,
        sourceMode,
        selectedPageIds:
          sourceMode === 'lesson_based' || sourceMode === 'mixed' ? selectedPageIds : undefined,
        selectedSourceIds:
          sourceMode === 'question_material' || sourceMode === 'mixed'
            ? selectedSourceIds
            : undefined,
        kcFocus: selectedKcIds.length > 0 ? selectedKcIds : undefined,
        strictSource,
        customPrompt: customPrompt.trim() || undefined,
      };
      const result = await apiFetch<{ questions: GeneratedQuestion[] }>('/questions/generate', {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setQuestions(
        (result.questions ?? []).map((q) => ({
          ...q,
          options: q.options ?? [],
          kcTags: q.kcTags ?? [],
          selected: true,
        })),
      );
      setStep('review');
    } catch (err: any) {
      setError(err?.message ?? 'Generation failed. Please try again.');
      setStep('config');
    }
  };

  /* ---------- save ---------- */
  const handleSave = async (addToAssessment: boolean) => {
    setSaving(true);
    setError(null);
    try {
      const selected = questions.filter((q) => q.selected);
      const result = await apiFetch<{ questionIds: string[] }>('/questions/generate/save', {
        method: 'POST',
        body: JSON.stringify({
          courseId,
          questions: selected,
          assessmentId: addToAssessment ? assessmentId : undefined,
        }),
      });
      onQuestionsGenerated?.(result.questionIds ?? []);
      onClose();
    } catch (err: any) {
      setError(err?.message ?? 'Failed to save questions.');
    } finally {
      setSaving(false);
    }
  };

  /* ---------- question editing helpers ---------- */
  const updateQuestion = useCallback((index: number, patch: Partial<GeneratedQuestion>) => {
    setQuestions((prev) => prev.map((q, i) => (i === index ? { ...q, ...patch } : q)));
  }, []);

  const removeQuestion = (index: number) => {
    setQuestions((prev) => prev.filter((_, i) => i !== index));
  };

  const toggleSelectAll = () => {
    const allSelected = questions.every((q) => q.selected);
    setQuestions((prev) => prev.map((q) => ({ ...q, selected: !allSelected })));
  };

  const selectedCount = questions.filter((q) => q.selected).length;

  /* ---------- early return ---------- */
  if (!open) return null;

  /* ================================================================ */
  /*  RENDER                                                           */
  /* ================================================================ */

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-3xl max-h-[90vh] flex flex-col">
        {/* -------- Header -------- */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200">
          <div>
            <h2 className="text-lg font-bold text-gray-900">AI Question Generator</h2>
            <p className="text-sm text-gray-500">
              {step === 'config' && 'Configure generation parameters'}
              {step === 'generating' && 'Generating questions...'}
              {step === 'review' && `Review ${questions.length} generated question(s)`}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 text-xl leading-none"
          >
            &times;
          </button>
        </div>

        {/* -------- Body -------- */}
        <div className="flex-1 overflow-y-auto px-6 py-4">
          {error && (
            <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg">
              {error}
            </div>
          )}

          {/* ======== STEP: CONFIG ======== */}
          {step === 'config' && (
            <div className="space-y-5">
              {/* 1. Question Types */}
              <fieldset>
                <legend className="text-sm font-semibold text-gray-700 mb-2">Question Types</legend>
                <div className="flex flex-wrap gap-3">
                  {(Object.entries(QUESTION_TYPE_LABELS) as [QuestionType, string][]).map(
                    ([type, label]) => (
                      <label key={type} className="flex items-center gap-2 text-sm text-gray-700">
                        <input
                          type="checkbox"
                          checked={selectedTypes.has(type)}
                          onChange={() => toggleType(type)}
                          className="rounded border-gray-300 text-indigo-600"
                        />
                        {label}
                      </label>
                    ),
                  )}
                </div>
                {selectedTypes.size === 0 && (
                  <p className="text-xs text-red-500 mt-1">Select at least one question type.</p>
                )}
              </fieldset>

              {/* 2. Quantity */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">Quantity</label>
                <input
                  type="number"
                  min={1}
                  max={50}
                  value={quantity}
                  onChange={(e) =>
                    setQuantity(Math.max(1, Math.min(50, Number(e.target.value) || 1)))
                  }
                  className="w-24 px-3 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>

              {/* 3. Difficulty Distribution */}
              <fieldset>
                <legend className="text-sm font-semibold text-gray-700 mb-2">
                  Difficulty Distribution
                </legend>
                <div className="flex gap-4">
                  {DIFFICULTY_LEVELS.map((d) => (
                    <div key={d} className="flex flex-col items-center">
                      <label className="text-xs text-gray-500 capitalize mb-1">{d}</label>
                      <input
                        type="number"
                        min={0}
                        max={quantity}
                        value={diffDist[d]}
                        onChange={(e) =>
                          setDiffDist((prev) => ({
                            ...prev,
                            [d]: Math.max(0, Number(e.target.value) || 0),
                          }))
                        }
                        className="w-16 px-2 py-1.5 text-sm text-center border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                      />
                    </div>
                  ))}
                </div>
                {diffSum !== quantity && (
                  <p className="text-xs text-amber-600 mt-1">
                    Sum is {diffSum} but quantity is {quantity}. They should match.
                  </p>
                )}
              </fieldset>

              {/* 4. Bloom's Level (collapsible) */}
              <div className="border border-gray-200 rounded-lg">
                <button
                  type="button"
                  onClick={() => setBloomsOpen((v) => !v)}
                  className="w-full flex items-center justify-between px-3 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 rounded-lg"
                >
                  <span>Bloom&apos;s Level Distribution (optional)</span>
                  <span className="text-gray-400">{bloomsOpen ? '\u25B2' : '\u25BC'}</span>
                </button>
                {bloomsOpen && (
                  <div className="px-3 pb-3 flex flex-wrap gap-3">
                    {BLOOMS_LEVELS.map((b) => (
                      <label
                        key={b}
                        className="flex items-center gap-1.5 text-sm text-gray-700 capitalize"
                      >
                        <input
                          type="checkbox"
                          checked={selectedBlooms.has(b)}
                          onChange={() => toggleBlooms(b)}
                          className="rounded border-gray-300 text-indigo-600"
                        />
                        {b}
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* 5. Source Mode */}
              <fieldset>
                <legend className="text-sm font-semibold text-gray-700 mb-2">Source Mode</legend>
                <div className="flex gap-4">
                  {(
                    [
                      ['lesson_based', 'Lesson-based'],
                      ['question_material', 'Question material'],
                      ['mixed', 'Mixed'],
                    ] as [SourceMode, string][]
                  ).map(([mode, label]) => (
                    <label key={mode} className="flex items-center gap-2 text-sm text-gray-700">
                      <input
                        type="radio"
                        name="sourceMode"
                        value={mode}
                        checked={sourceMode === mode}
                        onChange={() => setSourceMode(mode)}
                        className="text-indigo-600"
                      />
                      {label}
                    </label>
                  ))}
                </div>
              </fieldset>

              {/* 6. Page / Source Selectors */}
              {(sourceMode === 'lesson_based' || sourceMode === 'mixed') && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Course Pages
                  </label>
                  {loadingPages ? (
                    <p className="text-xs text-gray-400">Loading pages...</p>
                  ) : (
                    <select
                      multiple
                      value={selectedPageIds}
                      onChange={(e) =>
                        setSelectedPageIds(Array.from(e.target.selectedOptions, (o) => o.value))
                      }
                      className="w-full h-32 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      {pages.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.title}
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Hold Ctrl/Cmd to select multiple.</p>
                </div>
              )}

              {(sourceMode === 'question_material' || sourceMode === 'mixed') && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1">
                    Uploaded Documents
                  </label>
                  {loadingDocs ? (
                    <p className="text-xs text-gray-400">Loading documents...</p>
                  ) : (
                    <select
                      multiple
                      value={selectedSourceIds}
                      onChange={(e) =>
                        setSelectedSourceIds(Array.from(e.target.selectedOptions, (o) => o.value))
                      }
                      className="w-full h-32 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    >
                      {documents.map((d) => (
                        <option key={d.id} value={d.id}>
                          {d.documentTitle} ({d.filename})
                        </option>
                      ))}
                    </select>
                  )}
                  <p className="text-xs text-gray-400 mt-1">Hold Ctrl/Cmd to select multiple.</p>
                </div>
              )}

              {/* 7. KC Focus */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  KC Focus{' '}
                  <span className="font-normal text-gray-400">
                    (optional - auto-detect if empty)
                  </span>
                </label>
                {loadingKcs ? (
                  <p className="text-xs text-gray-400">Loading KCs...</p>
                ) : (
                  <select
                    multiple
                    value={selectedKcIds}
                    onChange={(e) =>
                      setSelectedKcIds(Array.from(e.target.selectedOptions, (o) => o.value))
                    }
                    className="w-full h-28 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  >
                    {kcs.map((kc) => (
                      <option key={kc.id} value={kc.id}>
                        {kc.name}
                      </option>
                    ))}
                  </select>
                )}
              </div>

              {/* 8. Strict Source Toggle */}
              <label className="flex items-center gap-2 text-sm text-gray-700">
                <input
                  type="checkbox"
                  checked={strictSource}
                  onChange={(e) => setStrictSource(e.target.checked)}
                  className="rounded border-gray-300 text-indigo-600"
                />
                <span className="font-semibold">Strict Source</span>
                <span className="text-gray-400 font-normal">
                  - questions must be grounded in source material
                </span>
              </label>

              {/* 9. Custom Prompt */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1">
                  Custom Prompt <span className="font-normal text-gray-400">(optional)</span>
                </label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  placeholder="Additional instructions for the AI..."
                  rows={3}
                  className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                />
              </div>
            </div>
          )}

          {/* ======== STEP: GENERATING ======== */}
          {step === 'generating' && (
            <div className="flex flex-col items-center justify-center py-16 gap-4">
              <div className="w-10 h-10 border-4 border-indigo-200 border-t-indigo-600 rounded-full animate-spin" />
              <p className="text-sm text-gray-600">Generating questions...</p>
            </div>
          )}

          {/* ======== STEP: REVIEW ======== */}
          {step === 'review' && (
            <div className="space-y-4">
              {questions.length === 0 && (
                <p className="text-sm text-gray-500 text-center py-8">
                  No questions were generated.
                </p>
              )}

              {questions.map((q, idx) => (
                <div
                  key={idx}
                  className={`border rounded-lg p-4 space-y-3 ${
                    q.selected
                      ? 'border-indigo-300 bg-indigo-50/30'
                      : 'border-gray-200 bg-gray-50/50'
                  }`}
                >
                  {/* Top row: select + type badge + delete */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <input
                        type="checkbox"
                        checked={q.selected}
                        onChange={(e) => updateQuestion(idx, { selected: e.target.checked })}
                        className="rounded border-gray-300 text-indigo-600"
                      />
                      <span
                        className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                          q.type === 'MCQ_SINGLE'
                            ? 'bg-blue-100 text-blue-700'
                            : q.type === 'MCQ_MULTI'
                              ? 'bg-purple-100 text-purple-700'
                              : 'bg-green-100 text-green-700'
                        }`}
                      >
                        {q.type}
                      </span>
                      <span className="text-xs text-gray-400">#{idx + 1}</span>
                    </div>
                    <button
                      onClick={() => removeQuestion(idx)}
                      className="text-red-400 hover:text-red-600 text-sm"
                      title="Remove question"
                    >
                      Delete
                    </button>
                  </div>

                  {/* Stem */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Stem</label>
                    <textarea
                      value={q.stem}
                      onChange={(e) => updateQuestion(idx, { stem: e.target.value })}
                      rows={2}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  {/* Options (MCQ) */}
                  {(q.type === 'MCQ_SINGLE' || q.type === 'MCQ_MULTI') && (
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Options
                      </label>
                      <div className="space-y-2">
                        {q.options.map((opt, optIdx) => (
                          <div key={optIdx} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={opt.isCorrect}
                              onChange={(e) => {
                                const newOptions = [...q.options];
                                newOptions[optIdx] = { ...opt, isCorrect: e.target.checked };
                                updateQuestion(idx, { options: newOptions });
                              }}
                              className="rounded border-gray-300 text-green-600"
                              title="Mark as correct"
                            />
                            <input
                              type="text"
                              value={opt.text}
                              onChange={(e) => {
                                const newOptions = [...q.options];
                                newOptions[optIdx] = { ...opt, text: e.target.value };
                                updateQuestion(idx, { options: newOptions });
                              }}
                              className="flex-1 px-2 py-1 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                            />
                            <button
                              onClick={() => {
                                const newOptions = q.options.filter((_, i) => i !== optIdx);
                                updateQuestion(idx, { options: newOptions });
                              }}
                              className="text-red-400 hover:text-red-600 text-xs"
                            >
                              Remove
                            </button>
                          </div>
                        ))}
                        <button
                          onClick={() => {
                            updateQuestion(idx, {
                              options: [...q.options, { text: '', isCorrect: false }],
                            });
                          }}
                          className="text-xs text-indigo-600 hover:text-indigo-800"
                        >
                          + Add option
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Expected answer + rubric (STRUCTURED) */}
                  {q.type === 'STRUCTURED' && (
                    <>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          Expected Answer
                        </label>
                        <textarea
                          value={q.expectedAnswer ?? ''}
                          onChange={(e) => updateQuestion(idx, { expectedAnswer: e.target.value })}
                          rows={2}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-500 mb-1">
                          Rubric
                        </label>
                        <textarea
                          value={q.rubric ?? ''}
                          onChange={(e) => updateQuestion(idx, { rubric: e.target.value })}
                          rows={2}
                          className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                        />
                      </div>
                    </>
                  )}

                  {/* Explanation */}
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">
                      Explanation
                    </label>
                    <textarea
                      value={q.explanation}
                      onChange={(e) => updateQuestion(idx, { explanation: e.target.value })}
                      rows={2}
                      className="w-full px-2 py-1.5 text-sm border border-gray-300 rounded-lg focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                  </div>

                  {/* Tags row */}
                  <div className="flex flex-wrap items-start gap-4">
                    {/* Difficulty */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Difficulty
                      </label>
                      <select
                        value={q.difficulty}
                        onChange={(e) =>
                          updateQuestion(idx, { difficulty: e.target.value as Difficulty })
                        }
                        className="px-2 py-1 text-sm border border-gray-300 rounded-lg"
                      >
                        {DIFFICULTY_LEVELS.map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* Bloom's */}
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        Bloom&apos;s Level
                      </label>
                      <select
                        value={q.bloomsLevel}
                        onChange={(e) =>
                          updateQuestion(idx, { bloomsLevel: e.target.value as BloomsLevel })
                        }
                        className="px-2 py-1 text-sm border border-gray-300 rounded-lg"
                      >
                        {BLOOMS_LEVELS.map((b) => (
                          <option key={b} value={b}>
                            {b}
                          </option>
                        ))}
                      </select>
                    </div>

                    {/* KC Tags */}
                    <div className="flex-1 min-w-[200px]">
                      <label className="block text-xs font-medium text-gray-500 mb-1">
                        KC Tags
                      </label>
                      <div className="flex flex-wrap gap-1 items-center">
                        {q.kcTags.map((tag) => (
                          <span
                            key={tag.id}
                            className="inline-flex items-center gap-1 px-2 py-0.5 bg-indigo-100 text-indigo-700 text-xs rounded-full"
                          >
                            {tag.name}
                            <button
                              onClick={() => {
                                updateQuestion(idx, {
                                  kcTags: q.kcTags.filter((t) => t.id !== tag.id),
                                });
                              }}
                              className="text-indigo-400 hover:text-indigo-700 leading-none"
                            >
                              &times;
                            </button>
                          </span>
                        ))}
                        <select
                          value=""
                          onChange={(e) => {
                            const kc = kcs.find((k) => k.id === e.target.value);
                            if (kc && !q.kcTags.some((t) => t.id === kc.id)) {
                              updateQuestion(idx, {
                                kcTags: [...q.kcTags, { id: kc.id, name: kc.name }],
                              });
                            }
                          }}
                          className="px-1 py-0.5 text-xs border border-gray-300 rounded"
                        >
                          <option value="">+ Add KC</option>
                          {kcs
                            .filter((kc) => !q.kcTags.some((t) => t.id === kc.id))
                            .map((kc) => (
                              <option key={kc.id} value={kc.id}>
                                {kc.name}
                              </option>
                            ))}
                        </select>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* -------- Footer -------- */}
        <div className="flex items-center justify-between px-6 py-4 border-t border-gray-200">
          {step === 'config' && (
            <>
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
              <button
                onClick={handleGenerate}
                disabled={!configValid}
                className="px-6 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Generate
              </button>
            </>
          )}

          {step === 'generating' && (
            <>
              <div />
              <button
                onClick={onClose}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                Cancel
              </button>
            </>
          )}

          {step === 'review' && (
            <>
              <div className="flex items-center gap-4">
                <button
                  onClick={toggleSelectAll}
                  className="text-sm text-indigo-600 hover:text-indigo-800"
                >
                  {questions.every((q) => q.selected) ? 'Deselect All' : 'Select All'}
                </button>
                <span className="text-sm text-gray-500">
                  {selectedCount} of {questions.length} selected
                </span>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setStep('config')}
                  className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
                >
                  Back
                </button>
                <button
                  onClick={() => handleSave(false)}
                  disabled={selectedCount === 0 || saving}
                  className="px-5 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {saving ? 'Saving...' : 'Save to Question Bank'}
                </button>
                {assessmentId && (
                  <button
                    onClick={() => handleSave(true)}
                    disabled={selectedCount === 0 || saving}
                    className="px-5 py-2 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {saving ? 'Saving...' : 'Save & Add to Assessment'}
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
