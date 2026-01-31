import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';

// ─── Types ──────────────────────────────────────────────

interface PageNode {
  id: string;
  title: string;
  hasContent: boolean;
}

interface ModuleNode {
  id: string;
  title: string;
  pages: PageNode[];
}

interface PageTree {
  courseTitle: string;
  modules: ModuleNode[];
}

interface EvalConfig {
  rubrics: string[];
  strictness: 'lenient' | 'moderate' | 'strict';
  depth: 'surface' | 'standard' | 'deep';
  customPrompt?: string;
}

interface EvalScores {
  formatting?: number;
  equations?: number;
  pedagogy?: number;
  rigor?: number;
  overall?: number;
  error?: boolean;
  message?: string;
}

interface EvalIssue {
  category: string;
  severity: string;
  location: string;
  message: string;
  suggestedFix: string | null;
  source?: string;
  autoFixable?: boolean;
}

interface PageResult {
  id: string;
  itemId: string;
  itemTitle: string;
  scores: EvalScores;
  issues: EvalIssue[];
  mathIssues: unknown[] | null;
  fixesApplied: boolean;
}

interface EvalRun {
  id: string;
  status: string;
  config: EvalConfig;
  summary: Record<string, number> | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  results: PageResult[];
}

// ─── Score Badge Component ──────────────────────────────

function ScoreBadge({ score, label }: { score: number | undefined; label: string }) {
  if (score === undefined) return null;
  const color =
    score >= 80
      ? 'bg-green-100 text-green-700'
      : score >= 60
        ? 'bg-yellow-100 text-yellow-700'
        : score >= 40
          ? 'bg-orange-100 text-orange-700'
          : 'bg-red-100 text-red-700';

  return (
    <span
      className={`inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-medium ${color}`}
    >
      {label}: {score}
    </span>
  );
}

function SeverityBadge({ severity }: { severity: string }) {
  const color =
    severity === 'error'
      ? 'bg-red-100 text-red-700'
      : severity === 'warning'
        ? 'bg-yellow-100 text-yellow-700'
        : 'bg-blue-100 text-blue-700';
  return (
    <span className={`px-1.5 py-0.5 rounded text-[10px] font-medium ${color}`}>{severity}</span>
  );
}

// ─── Main Component ─────────────────────────────────────

export function EvaluationCenterPage() {
  const { courseId } = useParams<{ courseId: string }>();

  // Tree
  const [tree, setTree] = useState<PageTree | null>(null);
  const [loadingTree, setLoadingTree] = useState(true);

  // Selection
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());

  // Config
  const [rubrics, setRubrics] = useState<string[]>([
    'formatting',
    'equations',
    'pedagogy',
    'rigor',
  ]);
  const [strictness, setStrictness] = useState<EvalConfig['strictness']>('moderate');
  const [depth, setDepth] = useState<EvalConfig['depth']>('standard');
  const [customPrompt, setCustomPrompt] = useState('');

  // Run state
  const [running, setRunning] = useState(false);
  const [activeRun, setActiveRun] = useState<EvalRun | null>(null);
  const [pollTimer, setPollTimer] = useState<ReturnType<typeof setInterval> | null>(null);

  // Past runs
  const [pastRuns, setPastRuns] = useState<EvalRun[]>([]);
  const [selectedPageResult, setSelectedPageResult] = useState<PageResult | null>(null);

  // Tab
  const [tab, setTab] = useState<'setup' | 'results' | 'history'>('setup');

  // ─── Load Tree ──────────────────────────────────────

  useEffect(() => {
    if (!courseId) return;
    setLoadingTree(true);
    apiFetch<PageTree>(`/courses/${courseId}/evaluation/tree`)
      .then(setTree)
      .catch(() => {})
      .finally(() => setLoadingTree(false));
  }, [courseId]);

  // ─── Selection Helpers ──────────────────────────────

  const togglePage = (pageId: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  const toggleModule = (mod: ModuleNode) => {
    const allSelected = mod.pages.every((p) => selectedPageIds.has(p.id));
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      for (const p of mod.pages) {
        if (allSelected) next.delete(p.id);
        else next.add(p.id);
      }
      return next;
    });
  };

  const selectAll = () => {
    if (!tree) return;
    const all = tree.modules.flatMap((m) => m.pages.map((p) => p.id));
    setSelectedPageIds(new Set(all));
  };

  const selectNone = () => setSelectedPageIds(new Set());

  // ─── Toggle Rubric ─────────────────────────────────

  const toggleRubric = (r: string) => {
    setRubrics((prev) => (prev.includes(r) ? prev.filter((x) => x !== r) : [...prev, r]));
  };

  // ─── Start Evaluation ──────────────────────────────

  const startEvaluation = async () => {
    if (!courseId || selectedPageIds.size === 0 || rubrics.length === 0) return;
    setRunning(true);
    setActiveRun(null);
    setSelectedPageResult(null);
    setTab('results');

    try {
      const { runId } = await apiFetch<{ runId: string; status: string }>(
        `/courses/${courseId}/evaluation/run`,
        {
          method: 'POST',
          body: JSON.stringify({
            pageIds: Array.from(selectedPageIds),
            config: { rubrics, strictness, depth, customPrompt: customPrompt || undefined },
          }),
        },
      );

      // Poll for completion
      const timer = setInterval(async () => {
        try {
          const run = await apiFetch<EvalRun>(`/courses/${courseId}/evaluation/runs/${runId}`);
          setActiveRun(run);
          if (run.status === 'COMPLETED' || run.status === 'FAILED') {
            clearInterval(timer);
            setPollTimer(null);
            setRunning(false);
          }
        } catch {
          clearInterval(timer);
          setPollTimer(null);
          setRunning(false);
        }
      }, 2000);
      setPollTimer(timer);
    } catch {
      setRunning(false);
    }
  };

  // Cleanup poll on unmount
  useEffect(() => {
    return () => {
      if (pollTimer) clearInterval(pollTimer);
    };
  }, [pollTimer]);

  // ─── Load Past Runs ─────────────────────────────────

  const loadPastRuns = useCallback(async () => {
    if (!courseId) return;
    try {
      const runs = await apiFetch<EvalRun[]>(`/courses/${courseId}/evaluation/runs`);
      setPastRuns(runs);
    } catch {
      /* silent */
    }
  }, [courseId]);

  useEffect(() => {
    if (tab === 'history') loadPastRuns();
  }, [tab, loadPastRuns]);

  // ─── Apply Fixes ────────────────────────────────────

  const handleApplyFixes = async (resultId: string) => {
    if (!courseId) return;
    try {
      const res = await apiFetch<{ applied: boolean; fixCount?: number; message?: string }>(
        `/courses/${courseId}/evaluation/apply-fixes`,
        {
          method: 'POST',
          body: JSON.stringify({ resultId, fixTypes: ['math', 'formatting'] }),
        },
      );
      if (res.applied) {
        alert(`Applied ${res.fixCount} fix(es) successfully.`);
        // Refresh run
        if (activeRun) {
          const run = await apiFetch<EvalRun>(
            `/courses/${courseId}/evaluation/runs/${activeRun.id}`,
          );
          setActiveRun(run);
        }
      } else {
        alert(res.message || 'No auto-fixable issues found.');
      }
    } catch {
      alert('Failed to apply fixes.');
    }
  };

  // ─── Export to PDF ──────────────────────────────────

  const handleExportPdf = () => {
    window.print();
  };

  // ─── Render ─────────────────────────────────────────

  return (
    <div className="max-w-7xl mx-auto px-4 py-6">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <Link
            to={`/teacher/courses/${courseId}`}
            className="text-xs text-indigo-600 hover:underline"
          >
            &larr; Back to Course Builder
          </Link>
          <h1 className="text-xl font-bold text-gray-900 mt-1">Content Evaluation Center</h1>
          {tree && <p className="text-sm text-gray-500">{tree.courseTitle}</p>}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 mb-4 border-b border-gray-200">
        {(['setup', 'results', 'history'] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t === 'setup' ? 'Setup & Run' : t === 'results' ? 'Results' : 'History'}
          </button>
        ))}
      </div>

      {/* ─── Setup Tab ─────────────────────────────────── */}
      {tab === 'setup' && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          {/* Tree Selector */}
          <div className="border border-gray-200 rounded-lg bg-white">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="text-sm font-semibold text-gray-700">Select Pages to Evaluate</h2>
              <div className="flex gap-2">
                <button onClick={selectAll} className="text-xs text-indigo-600 hover:underline">
                  Select All
                </button>
                <button onClick={selectNone} className="text-xs text-gray-500 hover:underline">
                  Clear
                </button>
              </div>
            </div>
            <div className="max-h-[500px] overflow-y-auto p-2">
              {loadingTree ? (
                <p className="p-4 text-sm text-gray-400">Loading course structure...</p>
              ) : tree && tree.modules.length > 0 ? (
                tree.modules.map((mod) => {
                  const allSelected =
                    mod.pages.length > 0 && mod.pages.every((p) => selectedPageIds.has(p.id));
                  const someSelected = mod.pages.some((p) => selectedPageIds.has(p.id));
                  return (
                    <div key={mod.id} className="mb-2">
                      <label className="flex items-center gap-2 px-2 py-1.5 rounded hover:bg-gray-50 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={allSelected}
                          ref={(el) => {
                            if (el) el.indeterminate = someSelected && !allSelected;
                          }}
                          onChange={() => toggleModule(mod)}
                          className="rounded border-gray-300 text-indigo-600"
                        />
                        <span className="text-sm font-medium text-gray-700">{mod.title}</span>
                        <span className="text-xs text-gray-400 ml-auto">
                          {mod.pages.length} pages
                        </span>
                      </label>
                      <div className="ml-6">
                        {mod.pages.map((page) => (
                          <label
                            key={page.id}
                            className="flex items-center gap-2 px-2 py-1 rounded hover:bg-gray-50 cursor-pointer"
                          >
                            <input
                              type="checkbox"
                              checked={selectedPageIds.has(page.id)}
                              onChange={() => togglePage(page.id)}
                              className="rounded border-gray-300 text-indigo-600"
                            />
                            <span className="text-sm text-gray-600">{page.title}</span>
                            {!page.hasContent && (
                              <span className="text-[10px] px-1 py-0.5 bg-gray-100 text-gray-400 rounded">
                                empty
                              </span>
                            )}
                          </label>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="p-4 text-sm text-gray-400">No pages found in this course.</p>
              )}
            </div>
          </div>

          {/* Config Panel */}
          <div className="space-y-4">
            <div className="border border-gray-200 rounded-lg bg-white p-4">
              <h2 className="text-sm font-semibold text-gray-700 mb-3">Evaluation Configuration</h2>

              {/* Rubrics */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Rubrics</label>
                <div className="flex flex-wrap gap-2">
                  {['formatting', 'equations', 'pedagogy', 'rigor'].map((r) => (
                    <button
                      key={r}
                      onClick={() => toggleRubric(r)}
                      className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${
                        rubrics.includes(r)
                          ? 'bg-indigo-100 border-indigo-300 text-indigo-700'
                          : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-gray-100'
                      }`}
                    >
                      {r.charAt(0).toUpperCase() + r.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Strictness */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Strictness</label>
                <select
                  value={strictness}
                  onChange={(e) => setStrictness(e.target.value as EvalConfig['strictness'])}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="lenient">Lenient</option>
                  <option value="moderate">Moderate</option>
                  <option value="strict">Strict</option>
                </select>
              </div>

              {/* Depth */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">Depth</label>
                <select
                  value={depth}
                  onChange={(e) => setDepth(e.target.value as EvalConfig['depth'])}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                >
                  <option value="surface">Surface (Quick scan)</option>
                  <option value="standard">Standard</option>
                  <option value="deep">Deep (Exhaustive)</option>
                </select>
              </div>

              {/* Custom Prompt */}
              <div className="mb-4">
                <label className="block text-xs font-medium text-gray-500 mb-1.5">
                  Custom Instructions (optional)
                </label>
                <textarea
                  value={customPrompt}
                  onChange={(e) => setCustomPrompt(e.target.value)}
                  rows={3}
                  className="w-full text-sm border border-gray-300 rounded-lg px-3 py-2"
                  placeholder="E.g., 'Focus on LaTeX equation formatting' or 'Check for AP Calculus standards'..."
                />
              </div>
            </div>

            {/* Run Button */}
            <button
              onClick={startEvaluation}
              disabled={running || selectedPageIds.size === 0 || rubrics.length === 0}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {running
                ? 'Evaluating...'
                : `Evaluate ${selectedPageIds.size} Page${selectedPageIds.size !== 1 ? 's' : ''}`}
            </button>

            {selectedPageIds.size === 0 && (
              <p className="text-xs text-gray-400 text-center">
                Select at least one page to evaluate
              </p>
            )}
          </div>
        </div>
      )}

      {/* ─── Results Tab ───────────────────────────────── */}
      {tab === 'results' && (
        <div>
          {!activeRun && !running && (
            <div className="text-center py-12">
              <p className="text-sm text-gray-400">
                No active evaluation. Go to Setup & Run to start one.
              </p>
            </div>
          )}

          {running && !activeRun && (
            <div className="text-center py-12">
              <div className="inline-block w-6 h-6 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mb-2" />
              <p className="text-sm text-gray-500">Starting evaluation...</p>
            </div>
          )}

          {activeRun && (
            <div>
              {/* Summary Bar */}
              <div className="border border-gray-200 rounded-lg bg-white p-4 mb-4">
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <h2 className="text-sm font-semibold text-gray-700">Evaluation Summary</h2>
                    <span
                      className={`px-2 py-0.5 rounded text-xs font-medium ${
                        activeRun.status === 'COMPLETED'
                          ? 'bg-green-100 text-green-700'
                          : activeRun.status === 'RUNNING'
                            ? 'bg-blue-100 text-blue-700'
                            : activeRun.status === 'FAILED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-600'
                      }`}
                    >
                      {activeRun.status}
                    </span>
                  </div>
                  <button
                    onClick={handleExportPdf}
                    className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                  >
                    Export / Print
                  </button>
                </div>

                {activeRun.summary && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(activeRun.summary).map(([key, val]) => (
                      <ScoreBadge
                        key={key}
                        label={key.charAt(0).toUpperCase() + key.slice(1)}
                        score={val}
                      />
                    ))}
                  </div>
                )}

                {activeRun.status === 'RUNNING' && (
                  <div className="mt-2 flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin" />
                    <span className="text-xs text-gray-500">
                      Evaluating... {activeRun.results.length} page(s) done
                    </span>
                  </div>
                )}

                {activeRun.errorMessage && (
                  <p className="mt-2 text-xs text-red-600">{activeRun.errorMessage}</p>
                )}
              </div>

              {/* Page Results Grid */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                {activeRun.results.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => setSelectedPageResult(result)}
                    className={`text-left border rounded-lg p-3 transition-colors ${
                      selectedPageResult?.id === result.id
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <span className="text-sm font-medium text-gray-700 truncate">
                        {result.itemTitle}
                      </span>
                      {result.fixesApplied && (
                        <span className="text-[10px] px-1.5 py-0.5 bg-green-100 text-green-600 rounded">
                          Fixed
                        </span>
                      )}
                    </div>
                    {result.scores.error ? (
                      <p className="text-xs text-red-500">
                        Evaluation error: {result.scores.message}
                      </p>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        {Object.entries(result.scores)
                          .filter(([k]) => k !== 'error' && k !== 'message')
                          .map(([key, val]) => (
                            <ScoreBadge key={key} label={key} score={val as number} />
                          ))}
                      </div>
                    )}
                    <div className="mt-1 text-[10px] text-gray-400">
                      {result.issues.length} issue{result.issues.length !== 1 ? 's' : ''}
                    </div>
                  </button>
                ))}
              </div>

              {/* Detailed Page Report */}
              {selectedPageResult && (
                <div className="border border-gray-200 rounded-lg bg-white p-4" id="eval-report">
                  <div className="flex items-center justify-between mb-4">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Detailed Report: {selectedPageResult.itemTitle}
                    </h3>
                    <div className="flex gap-2">
                      {!selectedPageResult.fixesApplied &&
                        selectedPageResult.issues.some((i) => i.autoFixable) && (
                          <button
                            onClick={() => handleApplyFixes(selectedPageResult.id)}
                            className="text-xs px-3 py-1.5 bg-indigo-600 text-white rounded hover:bg-indigo-700"
                          >
                            Auto-Fix Math Issues
                          </button>
                        )}
                    </div>
                  </div>

                  {/* Scores */}
                  <div className="flex flex-wrap gap-2 mb-4">
                    {Object.entries(selectedPageResult.scores)
                      .filter(([k]) => k !== 'error' && k !== 'message')
                      .map(([key, val]) => (
                        <ScoreBadge
                          key={key}
                          label={key.charAt(0).toUpperCase() + key.slice(1)}
                          score={val as number}
                        />
                      ))}
                  </div>

                  {/* Issues Table */}
                  {selectedPageResult.issues.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="w-full text-xs">
                        <thead>
                          <tr className="border-b border-gray-200">
                            <th className="text-left py-2 px-2 font-medium text-gray-500">
                              Severity
                            </th>
                            <th className="text-left py-2 px-2 font-medium text-gray-500">
                              Category
                            </th>
                            <th className="text-left py-2 px-2 font-medium text-gray-500">
                              Location
                            </th>
                            <th className="text-left py-2 px-2 font-medium text-gray-500">Issue</th>
                            <th className="text-left py-2 px-2 font-medium text-gray-500">
                              Suggested Fix
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {selectedPageResult.issues.map((issue, idx) => (
                            <tr key={idx} className="border-b border-gray-100 hover:bg-gray-50">
                              <td className="py-2 px-2">
                                <SeverityBadge severity={issue.severity} />
                              </td>
                              <td className="py-2 px-2 text-gray-600">{issue.category}</td>
                              <td className="py-2 px-2 text-gray-500">{issue.location}</td>
                              <td className="py-2 px-2 text-gray-700">{issue.message}</td>
                              <td className="py-2 px-2 text-gray-500 max-w-[200px] truncate">
                                {issue.suggestedFix || '—'}
                                {issue.autoFixable && (
                                  <span className="ml-1 text-[9px] px-1 py-0.5 bg-violet-100 text-violet-600 rounded">
                                    auto
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <p className="text-sm text-gray-400">No issues found for this page.</p>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── History Tab ───────────────────────────────── */}
      {tab === 'history' && (
        <div>
          {pastRuns.length === 0 ? (
            <p className="text-center py-12 text-sm text-gray-400">No past evaluation runs.</p>
          ) : (
            <div className="space-y-3">
              {pastRuns.map((run) => (
                <div
                  key={run.id}
                  className="border border-gray-200 rounded-lg bg-white p-4 hover:bg-gray-50 cursor-pointer"
                  onClick={() => {
                    setActiveRun(run);
                    setSelectedPageResult(null);
                    setTab('results');
                  }}
                >
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={`px-2 py-0.5 rounded text-xs font-medium ${
                          run.status === 'COMPLETED'
                            ? 'bg-green-100 text-green-700'
                            : run.status === 'FAILED'
                              ? 'bg-red-100 text-red-700'
                              : 'bg-gray-100 text-gray-600'
                        }`}
                      >
                        {run.status}
                      </span>
                      <span className="text-xs text-gray-500">
                        {new Date(run.createdAt).toLocaleString()}
                      </span>
                    </div>
                    <span className="text-xs text-gray-400">{run.results.length} pages</span>
                  </div>
                  {run.summary && (
                    <div className="flex flex-wrap gap-1">
                      {Object.entries(run.summary).map(([key, val]) => (
                        <ScoreBadge key={key} label={key} score={val} />
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
