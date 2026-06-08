import { useState, useEffect, useCallback } from 'react';
import katex from 'katex';
import { api } from '../../lib/api';
import {
  FlaskConical,
  Footprints,
  Layers,
  MessageCircleQuestion,
  ChevronDown,
  ChevronRight,
  Loader2,
  BookOpen,
  AlertCircle,
  RefreshCw,
  DollarSign,
  FileText,
  Zap,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface ModuleItemPdf {
  id: string;
  title: string;
  pdfFilename: string | null;
  moduleName: string;
  documentId: string | null;
  pageCount: number | null;
}

interface PregenCost {
  totalCost: number;
  inputTokens: number;
  outputTokens: number;
  callCount: number;
}

interface Exercise {
  id: string;
  pageNumber: number;
  strategy: string;
  setIndex: number;
  content: unknown;
  generatedAt: string | null;
}

// Practice-testing
interface PracticeQuestion {
  question: string;
  type: 'mcq' | 'short_answer';
  options?: string[];
  correctAnswer: string;
  explanation: string;
}

// Distributed-practice
interface Flashcard {
  front: string;
  back: string;
}

// Stepwise-learning
interface StepwiseStep {
  stepNumber: number;
  title: string;
  content: string;
  comprehensionCheck?: { question: string; hint: string; sampleAnswer: string };
}

// Interrogative-elaboration
interface SuggestedQuestion {
  question: string;
  type: 'why' | 'how';
  topic: string;
  difficulty: 'beginner' | 'intermediate' | 'advanced';
}

// ─── Constants ────────────────────────────────────────────────────────────────

const STRATEGIES = [
  { key: 'practice-testing', label: 'Practice Testing', icon: <FlaskConical size={14} /> },
  { key: 'distributed-practice', label: 'Distributed Practice', icon: <Layers size={14} /> },
  { key: 'stepwise-learning', label: 'Stepwise Learning', icon: <Footprints size={14} /> },
  {
    key: 'interrogative-elaboration',
    label: 'Interrogative Elaboration',
    icon: <MessageCircleQuestion size={14} />,
  },
] as const;

const DIFFICULTY_COLOR: Record<string, string> = {
  beginner: 'text-green-700 bg-green-50',
  intermediate: 'text-yellow-700 bg-yellow-50',
  advanced: 'text-red-700 bg-red-50',
};

// ─── Math-aware text renderer ─────────────────────────────────────────────────

type MathSegment = { type: 'text' | 'inline' | 'display'; content: string };

function parseMath(text: string): MathSegment[] {
  const segments: MathSegment[] = [];
  // Match $$...$$ (display) then $...$ (inline)
  const re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) segments.push({ type: 'text', content: text.slice(last, m.index) });
    const display = m[1];
    const inline = m[2];
    if (display !== undefined) segments.push({ type: 'display', content: display });
    else if (inline !== undefined) segments.push({ type: 'inline', content: inline });
    last = m.index + m[0].length;
  }
  if (last < text.length) segments.push({ type: 'text', content: text.slice(last) });
  return segments;
}

function MathText({ text, className }: { text: string; className?: string }) {
  if (!text) return null;
  const segments = parseMath(text);
  return (
    <span className={className}>
      {segments.map((seg, i) => {
        if (seg.type === 'text') return <span key={i}>{seg.content}</span>;
        try {
          return (
            <span
              key={i}
              dangerouslySetInnerHTML={{
                __html: katex.renderToString(seg.content, {
                  displayMode: seg.type === 'display',
                  throwOnError: false,
                }),
              }}
            />
          );
        } catch {
          return <span key={i}>{seg.content}</span>;
        }
      })}
    </span>
  );
}

// ─── Content renderers ────────────────────────────────────────────────────────

function PracticeTestingContent({ content }: { content: unknown }) {
  const questions = Array.isArray(content) ? (content as PracticeQuestion[]) : [];
  if (questions.length === 0)
    return <p className="text-xs text-gray-400 italic">No questions in this exercise.</p>;

  return (
    <div className="space-y-4">
      {questions.map((q, i) => (
        <div key={i} className="border border-gray-100 rounded-lg p-3 bg-white">
          <div className="flex items-start gap-2 mb-2">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                q.type === 'mcq' ? 'bg-blue-50 text-blue-700' : 'bg-purple-50 text-purple-700'
              }`}
            >
              {q.type === 'mcq' ? 'MCQ' : 'Short Answer'}
            </span>
            <MathText text={q.question} className="text-xs text-gray-800 font-medium" />
          </div>
          {q.options && q.options.length > 0 && (
            <ul className="ml-4 mb-2 space-y-1">
              {q.options.map((opt, j) => (
                <li
                  key={j}
                  className={`text-xs px-2 py-0.5 rounded ${
                    opt === q.correctAnswer
                      ? 'bg-green-50 text-green-800 font-medium'
                      : 'text-gray-600'
                  }`}
                >
                  {String.fromCharCode(65 + j)}. <MathText text={opt} />
                </li>
              ))}
            </ul>
          )}
          {q.type === 'short_answer' && (
            <p className="text-xs text-green-700 bg-green-50 rounded px-2 py-1 mb-1">
              <span className="font-medium">Answer:</span> <MathText text={q.correctAnswer} />
            </p>
          )}
          {q.explanation && (
            <p className="text-xs text-gray-500 italic mt-1">
              <span className="font-medium not-italic text-gray-600">Explanation:</span>{' '}
              <MathText text={q.explanation} />
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function DistributedPracticeContent({ content }: { content: unknown }) {
  const raw = content as { cards?: Flashcard[] } | Flashcard[] | null;
  const cards: Flashcard[] = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { cards?: Flashcard[] })?.cards)
      ? (raw as { cards: Flashcard[] }).cards
      : [];

  if (cards.length === 0)
    return <p className="text-xs text-gray-400 italic">No flashcards in this exercise.</p>;

  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
      {cards.map((card, i) => (
        <div key={i} className="border border-gray-100 rounded-lg overflow-hidden">
          <div className="bg-blue-50 px-3 py-2 border-b border-blue-100">
            <p className="text-[10px] text-blue-500 font-medium uppercase tracking-wide mb-0.5">
              Front
            </p>
            <MathText text={card.front} className="text-xs text-blue-900" />
          </div>
          <div className="px-3 py-2 bg-white">
            <p className="text-[10px] text-gray-400 font-medium uppercase tracking-wide mb-0.5">
              Back
            </p>
            <MathText text={card.back} className="text-xs text-gray-700" />
          </div>
        </div>
      ))}
    </div>
  );
}

function StepwiseLearningContent({ content }: { content: unknown }) {
  const raw = content as { steps?: StepwiseStep[]; summary?: string } | null;
  const steps: StepwiseStep[] = Array.isArray(raw?.steps) ? raw!.steps : [];
  const summary = raw?.summary ?? '';

  if (steps.length === 0)
    return <p className="text-xs text-gray-400 italic">No steps in this exercise.</p>;

  return (
    <div className="space-y-3">
      {summary && (
        <p className="text-xs text-gray-600 bg-gray-50 rounded px-3 py-2 border border-gray-100">
          <span className="font-medium text-gray-700">Summary:</span> {summary}
        </p>
      )}
      {steps.map((step) => (
        <div key={step.stepNumber} className="border border-gray-100 rounded-lg p-3 bg-white">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] bg-indigo-100 text-indigo-700 rounded-full px-1.5 py-0.5 font-semibold shrink-0">
              Step {step.stepNumber}
            </span>
            <MathText text={step.title} className="text-xs font-semibold text-gray-800" />
          </div>
          <MathText text={step.content} className="text-xs text-gray-600 mb-2 block" />
          {step.comprehensionCheck && (
            <div className="bg-yellow-50 border border-yellow-100 rounded px-2 py-1.5 space-y-0.5">
              <p className="text-[10px] font-medium text-yellow-700 uppercase tracking-wide">
                Comprehension check
              </p>
              <MathText text={step.comprehensionCheck.question} className="text-xs text-gray-700" />
              {step.comprehensionCheck.hint && (
                <p className="text-[11px] text-gray-500 italic">
                  Hint: <MathText text={step.comprehensionCheck.hint} />
                </p>
              )}
              {step.comprehensionCheck.sampleAnswer && (
                <p className="text-[11px] text-green-700">
                  <span className="font-medium">Sample answer:</span>{' '}
                  <MathText text={step.comprehensionCheck.sampleAnswer} />
                </p>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

function InterrogativeElaborationContent({ content }: { content: unknown }) {
  const raw = content as {
    suggestedQuestions?: SuggestedQuestion[];
    keyConcepts?: string[];
  } | null;
  const questions: SuggestedQuestion[] = Array.isArray(raw?.suggestedQuestions)
    ? raw!.suggestedQuestions
    : [];
  const concepts: string[] = Array.isArray(raw?.keyConcepts) ? raw!.keyConcepts : [];

  if (questions.length === 0)
    return <p className="text-xs text-gray-400 italic">No questions in this exercise.</p>;

  return (
    <div className="space-y-3">
      {concepts.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {concepts.map((c, i) => (
            <span key={i} className="text-[10px] bg-gray-100 text-gray-600 rounded px-1.5 py-0.5">
              {c}
            </span>
          ))}
        </div>
      )}
      {questions.map((q, i) => (
        <div key={i} className="border border-gray-100 rounded-lg p-3 bg-white">
          <div className="flex items-start gap-2">
            <span
              className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                q.type === 'why' ? 'bg-orange-50 text-orange-700' : 'bg-teal-50 text-teal-700'
              }`}
            >
              {q.type.toUpperCase()}
            </span>
            {q.difficulty && (
              <span
                className={`text-[10px] px-1.5 py-0.5 rounded font-medium shrink-0 ${
                  DIFFICULTY_COLOR[q.difficulty] ?? 'bg-gray-50 text-gray-600'
                }`}
              >
                {q.difficulty}
              </span>
            )}
            <MathText text={q.question} className="text-xs text-gray-800" />
          </div>
          {q.topic && (
            <p className="text-[11px] text-gray-400 mt-1">
              Topic: <MathText text={q.topic} />
            </p>
          )}
        </div>
      ))}
    </div>
  );
}

function ExerciseContent({ strategy, content }: { strategy: string; content: unknown }) {
  switch (strategy) {
    case 'practice-testing':
      return <PracticeTestingContent content={content} />;
    case 'distributed-practice':
      return <DistributedPracticeContent content={content} />;
    case 'stepwise-learning':
      return <StepwiseLearningContent content={content} />;
    case 'interrogative-elaboration':
      return <InterrogativeElaborationContent content={content} />;
    default:
      return (
        <pre className="text-xs font-mono text-gray-600 whitespace-pre-wrap">
          {JSON.stringify(content, null, 2)}
        </pre>
      );
  }
}

// ─── Page row with per-strategy accordion ─────────────────────────────────────

function PageRow({ pageNumber, exercises }: { pageNumber: number; exercises: Exercise[] }) {
  const [expanded, setExpanded] = useState(false);
  const [activeStrategy, setActiveStrategy] = useState<string>(STRATEGIES[0].key);

  const strategyExercises = exercises.filter((e) => e.strategy === activeStrategy);

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center justify-between px-4 py-2.5 bg-white hover:bg-gray-50 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <BookOpen size={13} className="text-gray-400 shrink-0" />
          <span className="text-sm font-medium text-gray-700">Page {pageNumber}</span>
          <span className="text-xs text-gray-400">
            ({exercises.length} exercise{exercises.length !== 1 ? 's' : ''} ready)
          </span>
        </div>
        {expanded ? (
          <ChevronDown size={14} className="text-gray-400" />
        ) : (
          <ChevronRight size={14} className="text-gray-400" />
        )}
      </button>

      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50">
          {/* Strategy tabs */}
          <div className="flex gap-0 border-b border-gray-200 bg-white px-3 pt-2">
            {STRATEGIES.map((s) => {
              const hasContent = exercises.some((e) => e.strategy === s.key);
              return (
                <button
                  key={s.key}
                  onClick={() => setActiveStrategy(s.key)}
                  disabled={!hasContent}
                  className={`flex items-center gap-1 px-3 py-1.5 text-xs border-b-2 transition-colors mr-1 ${
                    activeStrategy === s.key
                      ? 'border-blue-600 text-blue-600 font-medium'
                      : hasContent
                        ? 'border-transparent text-gray-500 hover:text-gray-700'
                        : 'border-transparent text-gray-300 cursor-not-allowed'
                  }`}
                >
                  {s.icon}
                  <span>{s.label}</span>
                  {!hasContent && <span className="text-[9px] text-gray-300">(none)</span>}
                </button>
              );
            })}
          </div>

          {/* Content */}
          <div className="p-4">
            {strategyExercises.length === 0 ? (
              <p className="text-xs text-gray-400 italic">
                No pre-generated content for this strategy on this page.
              </p>
            ) : (
              <div className="space-y-6">
                {strategyExercises.map((ex) => (
                  <div key={ex.id}>
                    {strategyExercises.length > 1 && (
                      <p className="text-[10px] text-gray-400 font-medium uppercase mb-2">
                        Set {ex.setIndex + 1}
                      </p>
                    )}
                    <ExerciseContent strategy={ex.strategy} content={ex.content} />
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

interface PreGenContentTabProps {
  courseId: string;
}

export function PreGenContentTab({ courseId }: PreGenContentTabProps) {
  const [items, setItems] = useState<ModuleItemPdf[]>([]);
  const [itemsLoading, setItemsLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<string | null>(null);

  const [exercises, setExercises] = useState<Exercise[]>([]);
  const [exLoading, setExLoading] = useState(false);
  const [exError, setExError] = useState<string | null>(null);

  const [cost, setCost] = useState<PregenCost | null>(null);
  const [queuing, setQueuing] = useState(false);
  const [polling, setPolling] = useState(false);

  // Fetch PDF module items once
  useEffect(() => {
    void (async () => {
      try {
        const data = await api.get<ModuleItemPdf[]>(
          `/pre-generation/module-items/list?courseId=${encodeURIComponent(courseId)}`,
        );
        setItems(data);
        const [first] = data;
        if (first) {
          setSelectedItemId(first.id);
          setSelectedDocId(first.documentId);
        }
      } catch {
        /* ignore */
      } finally {
        setItemsLoading(false);
      }
    })();
  }, [courseId]);

  // Fetch course-level cost once
  useEffect(() => {
    void api
      .get<PregenCost>(`/pre-generation/cost/${courseId}`)
      .then(setCost)
      .catch(() => {});
  }, [courseId]);

  // Fetch exercises whenever the resolved documentId changes
  const fetchExercises = useCallback(async (documentId: string) => {
    setExLoading(true);
    setExError(null);
    try {
      const data = await api.get<Exercise[]>(
        `/pre-generation/exercises?documentId=${encodeURIComponent(documentId)}`,
      );
      setExercises(data);
      // Auto-poll if nothing is ready yet (exercises may still be generating)
      if (data.length === 0) setPolling(true);
    } catch (err) {
      setExError(err instanceof Error ? err.message : 'Failed to load exercises');
    } finally {
      setExLoading(false);
    }
  }, []);

  useEffect(() => {
    setPolling(false);
    if (selectedDocId) void fetchExercises(selectedDocId);
    else setExercises([]);
  }, [selectedDocId, fetchExercises]);

  // When selected item has no documentId yet, poll the items list until it's indexed
  useEffect(() => {
    if (!selectedItemId || selectedDocId) return;
    let ticks = 0;
    const id = setInterval(async () => {
      ticks++;
      try {
        const data = await api.get<ModuleItemPdf[]>(
          `/pre-generation/module-items/list?courseId=${encodeURIComponent(courseId)}`,
        );
        setItems(data);
        const current = data.find((i) => i.id === selectedItemId);
        if (current?.documentId) {
          setSelectedDocId(current.documentId); // triggers exercise fetch + polling
        }
      } catch {
        /* ignore */
      }
      if (ticks >= 24) clearInterval(id);
    }, 5_000);
    return () => clearInterval(id);
  }, [selectedItemId, selectedDocId, courseId]);

  // Poll every 5 s until the first exercises appear (max 2 min)
  useEffect(() => {
    if (!polling || !selectedDocId) return;
    let ticks = 0;
    const id = setInterval(async () => {
      ticks++;
      try {
        const data = await api.get<Exercise[]>(
          `/pre-generation/exercises?documentId=${encodeURIComponent(selectedDocId)}`,
        );
        if (data.length > 0) {
          setExercises(data);
          setPolling(false);
        }
      } catch {
        /* ignore */
      }
      if (ticks >= 24) setPolling(false);
    }, 5_000);
    return () => clearInterval(id);
  }, [polling, selectedDocId]);

  const handleItemChange = (itemId: string) => {
    const item = items.find((i) => i.id === itemId);
    if (!item) return;
    setSelectedItemId(itemId);
    setSelectedDocId(item.documentId);
    setExercises([]);
    setExError(null);
  };

  const handleQueue = async () => {
    if (!selectedItemId) return;
    const item = items.find((i) => i.id === selectedItemId);
    const isFirst = !item?.documentId;
    const confirmed = window.confirm(
      isFirst
        ? `Generate pre-built exercises for "${item?.title ?? 'this PDF'}"?\n\nThe PDF will be indexed and exercises for all 4 learning strategies will be queued. This will consume LLM credits.`
        : `Re-generate all exercises for "${item?.title ?? 'this PDF'}"?\n\nThis will reset all existing exercises and re-queue them. This will consume additional LLM credits.`,
    );
    if (!confirmed) return;

    setQueuing(true);
    try {
      const result = await api.post<{ documentId: string; queued: number }>(
        `/pre-generation/module-items/${encodeURIComponent(selectedItemId)}/queue`,
      );
      setItems((prev) =>
        prev.map((i) => (i.id === selectedItemId ? { ...i, documentId: result.documentId } : i)),
      );
      setSelectedDocId(result.documentId);
      setExercises([]);
      setPolling(true);
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to queue generation');
    } finally {
      setQueuing(false);
    }
  };

  // Group exercises by page
  const pageMap = exercises.reduce<Map<number, Exercise[]>>((acc, ex) => {
    const arr = acc.get(ex.pageNumber) ?? [];
    arr.push(ex);
    acc.set(ex.pageNumber, arr);
    return acc;
  }, new Map());
  const sortedPages = [...pageMap.keys()].sort((a, b) => a - b);

  const selectedItem = items.find((i) => i.id === selectedItemId);

  if (itemsLoading) {
    return (
      <div className="flex items-center gap-2 text-gray-500 text-sm">
        <Loader2 size={16} className="animate-spin" />
        Loading PDFs…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex items-start gap-3 bg-amber-50 border border-amber-200 rounded-lg p-4 text-sm text-amber-800">
        <FileText size={16} className="shrink-0 mt-0.5" />
        <span>
          No PDF module items found in this course. Add a PDF to a course module first via Course
          Builder.
        </span>
      </div>
    );
  }

  return (
    <div>
      <p className="text-sm text-gray-500 mb-4">
        Select a PDF to view or generate pre-built exercises for each page across all 4 learning
        strategies.
      </p>

      {/* Cost summary */}
      {cost && cost.callCount > 0 && (
        <div className="mb-4 flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-2.5">
          <DollarSign size={14} className="text-gray-400 shrink-0" />
          <div className="flex items-center gap-4 flex-wrap">
            <span className="text-sm font-semibold text-gray-800">
              Total pre-generation cost:{' '}
              <span className="text-blue-700">
                {cost.totalCost < 0.0001 && cost.totalCost > 0
                  ? '< $0.0001'
                  : `$${cost.totalCost.toFixed(4)}`}
              </span>
            </span>
            <span className="text-xs text-gray-500">
              {(cost.inputTokens + cost.outputTokens).toLocaleString()} tokens · {cost.callCount}{' '}
              LLM calls
            </span>
          </div>
        </div>
      )}

      {/* PDF selector + action button */}
      <div className="mb-4 flex items-end gap-3">
        <div className="flex-1 max-w-md">
          <label className="text-xs font-medium text-gray-600 block mb-1">PDF</label>
          <select
            value={selectedItemId ?? ''}
            onChange={(e) => handleItemChange(e.target.value)}
            className="text-sm border border-gray-300 rounded-md px-3 py-1.5 focus:outline-none focus:border-blue-400 w-full"
          >
            {items.map((item) => (
              <option key={item.id} value={item.id}>
                {item.moduleName} / {item.title.replace(/\s*\(pdf\)\s*/gi, '').trim()}
                {item.pageCount ? ` (${item.pageCount} pages)` : ''}
                {!item.documentId ? ' — not indexed' : ''}
              </option>
            ))}
          </select>
        </div>
        <button
          onClick={() => void handleQueue()}
          disabled={!selectedItemId || queuing}
          className={`flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-white disabled:bg-gray-300 disabled:cursor-not-allowed rounded-md transition-colors shrink-0 ${
            selectedItem?.documentId
              ? 'bg-orange-500 hover:bg-orange-600'
              : 'bg-blue-600 hover:bg-blue-700'
          }`}
        >
          {queuing ? (
            <Loader2 size={14} className="animate-spin" />
          ) : selectedItem?.documentId ? (
            <RefreshCw size={14} />
          ) : (
            <Zap size={14} />
          )}
          {queuing ? 'Indexing…' : selectedItem?.documentId ? 'Re-generate' : 'Generate'}
        </button>
      </div>

      {/* Not yet indexed banner */}
      {selectedItem && !selectedItem.documentId && (
        <div className="mb-4 flex items-start gap-3 bg-blue-50 border border-blue-200 rounded-lg px-4 py-3 text-sm text-blue-800">
          {queuing ? (
            <Loader2 size={15} className="shrink-0 mt-0.5 animate-spin" />
          ) : (
            <Zap size={15} className="shrink-0 mt-0.5" />
          )}
          <span>
            {queuing
              ? 'Indexing PDF and queuing exercises…'
              : 'This lecture has not been indexed yet. Click   Generate   or  Re-generate All  to index it and queue pre-generation for all 4 learning strategies.'}
          </span>
        </div>
      )}

      {/* Exercise list */}
      {selectedItem?.documentId && (
        <>
          {exLoading ? (
            <div className="flex items-center gap-2 text-gray-500 text-sm">
              <Loader2 size={16} className="animate-spin" />
              Loading exercises…
            </div>
          ) : exError ? (
            <div className="flex items-center gap-2 text-red-600 text-sm">
              <AlertCircle size={16} />
              {exError}
            </div>
          ) : sortedPages.length === 0 ? (
            <div className="flex items-center gap-2 text-sm text-gray-500">
              {polling && <Loader2 size={15} className="animate-spin shrink-0" />}
              {polling
                ? 'Generating exercises… this takes a minute or two, the page will update automatically.'
                : 'No pre-generated exercises ready yet. Click Generate / Re-generate to queue them.'}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-400">
                {sortedPages.length} page{sortedPages.length !== 1 ? 's' : ''} with pre-generated
                content · {exercises.length} total exercise
                {exercises.length !== 1 ? 's' : ''}
              </p>
              {sortedPages.map((pageNum) => (
                <PageRow key={pageNum} pageNumber={pageNum} exercises={pageMap.get(pageNum)!} />
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
