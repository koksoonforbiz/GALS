import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { apiFetch } from '../../lib/api';
import { InfoTooltip } from '../../components/InfoTooltip';
import { formatDateTimeSGT } from '../../lib/formatDateTime';

interface EvaluationCenterProps {
  courseId?: string;
  embedded?: boolean;
}

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
  blockId?: string;
  message: string;
  original?: string;
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

// ─── Score Badge ────────────────────────────────────────

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

// ─── Issue Row (expandable with per-issue fix button) ───

function IssueRow({
  issue,
  index,
  onApplyFix,
  applyingIndex,
}: {
  issue: EvalIssue;
  index: number;
  onApplyFix: ((idx: number) => void) | null;
  applyingIndex: number | null;
}) {
  const [expanded, setExpanded] = useState(false);
  const hasFix = issue.suggestedFix && issue.suggestedFix.length > 0;

  return (
    <div className="border-b border-gray-100 hover:bg-gray-50">
      <div className="flex items-start gap-3 py-3 px-3">
        {/* Severity */}
        <div className="pt-0.5 shrink-0 w-16">
          <SeverityBadge severity={issue.severity} />
        </div>

        {/* Category */}
        <div className="shrink-0 w-20 text-xs text-gray-600 pt-0.5">{issue.category}</div>

        {/* Location */}
        <div className="shrink-0 w-40 text-xs text-gray-500 pt-0.5">{issue.location}</div>

        {/* Issue message */}
        <div className="flex-1 min-w-0 text-xs text-gray-700">{issue.message}</div>

        {/* Actions */}
        <div className="shrink-0 flex items-center gap-2">
          {hasFix && (
            <button
              onClick={() => setExpanded(!expanded)}
              className="text-[10px] px-2 py-1 text-indigo-600 hover:bg-indigo-50 rounded"
            >
              {expanded ? 'Hide fix' : 'Show fix'}
            </button>
          )}
          {issue.autoFixable && onApplyFix && (
            <button
              onClick={() => onApplyFix(index)}
              disabled={applyingIndex !== null}
              className="text-[10px] px-2.5 py-1 bg-emerald-600 text-white rounded hover:bg-emerald-700 disabled:opacity-50 whitespace-nowrap"
            >
              {applyingIndex === index ? 'Applying...' : 'Apply Fix'}
              <span className="ml-1 inline-flex">
                <InfoTooltip
                  text="Apply the AI-suggested fix for this specific issue. Modifies page content."
                  warn={true}
                />
              </span>
            </button>
          )}
        </div>
      </div>

      {/* Expanded suggested fix */}
      {expanded && hasFix && (
        <div className="mx-3 mb-3 p-3 bg-gray-50 border border-gray-200 rounded text-xs space-y-2">
          {issue.original && (
            <div>
              <div className="text-[10px] font-medium text-red-400 mb-1">Original:</div>
              <pre className="whitespace-pre-wrap break-words text-red-700 bg-red-50 p-2 rounded font-mono text-[11px] leading-relaxed">
                {issue.original}
              </pre>
            </div>
          )}
          <div>
            <div className="text-[10px] font-medium text-emerald-500 mb-1">
              {issue.original ? 'Replacement:' : 'Suggested Fix:'}
            </div>
            <pre className="whitespace-pre-wrap break-words text-emerald-700 bg-emerald-50 p-2 rounded font-mono text-[11px] leading-relaxed">
              {issue.suggestedFix}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── PDF Export ─────────────────────────────────────────

function generateReportHtml(run: EvalRun, tree: PageTree | null): string {
  const now = formatDateTimeSGT(new Date());
  const courseTitle = tree?.courseTitle || 'Course';

  const scoreColor = (s: number) =>
    s >= 80 ? '#16a34a' : s >= 60 ? '#ca8a04' : s >= 40 ? '#ea580c' : '#dc2626';

  const severityColor = (s: string) =>
    s === 'error' ? '#dc2626' : s === 'warning' ? '#ca8a04' : '#2563eb';

  let html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<title>Evaluation Report — ${courseTitle}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; margin: 40px; color: #1f2937; font-size: 13px; line-height: 1.5; }
  h1 { font-size: 22px; margin-bottom: 4px; }
  h2 { font-size: 16px; margin-top: 28px; margin-bottom: 8px; padding-bottom: 4px; border-bottom: 1px solid #e5e7eb; }
  h3 { font-size: 14px; margin-top: 20px; margin-bottom: 6px; }
  .meta { color: #6b7280; font-size: 12px; margin-bottom: 20px; }
  .score-bar { display: flex; gap: 8px; flex-wrap: wrap; margin: 8px 0; }
  .score { display: inline-block; padding: 3px 10px; border-radius: 4px; font-size: 12px; font-weight: 600; }
  table { width: 100%; border-collapse: collapse; margin: 8px 0 16px; font-size: 12px; }
  th { text-align: left; padding: 6px 8px; background: #f9fafb; border-bottom: 2px solid #e5e7eb; font-weight: 600; color: #374151; }
  td { padding: 6px 8px; border-bottom: 1px solid #f3f4f6; vertical-align: top; }
  .severity { display: inline-block; padding: 1px 6px; border-radius: 3px; font-size: 10px; font-weight: 600; color: white; }
  .fix-cell { max-width: 300px; word-wrap: break-word; color: #6b7280; }
  .page-break { page-break-before: always; }
  @media print { body { margin: 20px; } }
</style></head><body>`;

  html += `<h1>Content Evaluation Report</h1>`;
  html += `<div class="meta">${courseTitle} &mdash; Generated ${now}</div>`;

  // Summary
  if (run.summary) {
    html += `<h2>Overall Summary</h2><div class="score-bar">`;
    for (const [key, val] of Object.entries(run.summary)) {
      html += `<span class="score" style="background:${scoreColor(val)}22;color:${scoreColor(val)}">${key.charAt(0).toUpperCase() + key.slice(1)}: ${val}</span>`;
    }
    html += `</div>`;
    html += `<p>${run.results.length} page(s) evaluated &bull; Status: ${run.status}</p>`;
  }

  // Per-page reports
  for (const result of run.results) {
    html += `<div class="page-break"></div>`;
    html += `<h2>${result.itemTitle}</h2>`;

    if (result.scores.error) {
      html += `<p style="color:#dc2626">Evaluation error: ${result.scores.message || 'Unknown'}</p>`;
      continue;
    }

    // Scores
    html += `<div class="score-bar">`;
    for (const [key, val] of Object.entries(result.scores)) {
      if (key === 'error' || key === 'message') continue;
      const v = val as number;
      html += `<span class="score" style="background:${scoreColor(v)}22;color:${scoreColor(v)}">${key.charAt(0).toUpperCase() + key.slice(1)}: ${v}</span>`;
    }
    html += `</div>`;

    // Issues table
    if (result.issues.length > 0) {
      html += `<h3>Issues (${result.issues.length})</h3>`;
      html += `<table><thead><tr><th>Severity</th><th>Category</th><th>Location</th><th>Issue</th><th>Suggested Fix</th></tr></thead><tbody>`;
      for (const issue of result.issues) {
        html += `<tr>`;
        html += `<td><span class="severity" style="background:${severityColor(issue.severity)}">${issue.severity}</span></td>`;
        html += `<td>${issue.category}</td>`;
        html += `<td>${issue.location}</td>`;
        html += `<td>${issue.message}</td>`;
        html += `<td class="fix-cell">${issue.suggestedFix || '—'}</td>`;
        html += `</tr>`;
      }
      html += `</tbody></table>`;
    } else {
      html += `<p style="color:#9ca3af">No issues found.</p>`;
    }

    if (result.fixesApplied) {
      html += `<p style="color:#16a34a;font-size:11px">&#10003; Auto-fixes have been applied to this page.</p>`;
    }
  }

  html += `</body></html>`;
  return html;
}

// ─── Main Component ─────────────────────────────────────

export function EvaluationCenterPage({
  courseId: propCourseId,
  embedded,
}: EvaluationCenterProps = {}) {
  const { courseId: paramCourseId } = useParams<{ courseId: string }>();
  const courseId = propCourseId || paramCourseId;

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
  const [historySelectedRun, setHistorySelectedRun] = useState<EvalRun | null>(null);
  const [historyPageResult, setHistoryPageResult] = useState<PageResult | null>(null);
  const [selectedPageResult, setSelectedPageResult] = useState<PageResult | null>(null);

  // Per-issue fix state
  const [applyingIndex, setApplyingIndex] = useState<number | null>(null);

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
    setSelectedPageIds(new Set(tree.modules.flatMap((m) => m.pages.map((p) => p.id))));
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

  // ─── Refresh active run helper ──────────────────────
  // Use a ref to avoid stale closure issues with activeRun/selectedPageResult
  const activeRunRef = { current: activeRun };
  activeRunRef.current = activeRun;
  const selectedPageResultRef = { current: selectedPageResult };
  selectedPageResultRef.current = selectedPageResult;

  const refreshActiveRun = useCallback(async () => {
    const currentRun = activeRunRef.current;
    if (!courseId || !currentRun) return;
    try {
      const run = await apiFetch<EvalRun>(`/courses/${courseId}/evaluation/runs/${currentRun.id}`);
      setActiveRun(run);
      // Also refresh selected page result if it exists
      const currentSelected = selectedPageResultRef.current;
      if (currentSelected) {
        const updated = run.results.find((r) => r.id === currentSelected.id);
        if (updated) setSelectedPageResult(updated);
      }
    } catch {
      /* silent */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [courseId]);

  // ─── Apply All Auto-Fixes for a page ────────────────

  const [fixMessage, setFixMessage] = useState<string | null>(null);

  const handleApplyAllFixes = async (resultId: string) => {
    if (!courseId) return;
    setFixMessage(null);
    try {
      const res = await apiFetch<{ applied: boolean; fixCount?: number; message?: string }>(
        `/courses/${courseId}/evaluation/apply-fixes`,
        {
          method: 'POST',
          body: JSON.stringify({ resultId, fixTypes: ['math', 'formatting', 'llm'] }),
        },
      );
      if (res.applied) {
        setFixMessage(`Applied ${res.fixCount ?? 0} fix(es) successfully.`);
        await refreshActiveRun();
      } else {
        setFixMessage(res.message || 'No auto-fixable issues found.');
      }
      return res;
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to apply fixes';
      setFixMessage(msg);
      return { applied: false, message: msg };
    }
  };

  // ─── Apply Single Issue Fix ──────────────────────────

  const handleApplySingleFix = async (issueIndex: number) => {
    if (!courseId || !selectedPageResult) return;
    setApplyingIndex(issueIndex);
    setFixMessage(null);
    try {
      const res = await apiFetch<{ applied: boolean; fixCount?: number; message?: string }>(
        `/courses/${courseId}/evaluation/apply-fixes`,
        {
          method: 'POST',
          body: JSON.stringify({
            resultId: selectedPageResult.id,
            fixTypes: ['math', 'formatting', 'llm'],
            issueIndex,
          }),
        },
      );
      if (res.applied) {
        setFixMessage(`Fix applied successfully.`);
        await refreshActiveRun();
      } else {
        setFixMessage(res.message || 'Could not apply this fix.');
      }
    } catch (err) {
      setFixMessage(err instanceof Error ? err.message : 'Failed to apply fix');
    } finally {
      setApplyingIndex(null);
    }
  };

  // ─── Export PDF ──────────────────────────────────────

  const handleExportPdf = () => {
    if (!activeRun) return;
    const html = generateReportHtml(activeRun, tree);
    const blob = new Blob([html], { type: 'text/html' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) {
      win.addEventListener('load', () => {
        setTimeout(() => {
          win.print();
          URL.revokeObjectURL(url);
        }, 300);
      });
    }
  };

  // ─── Render ─────────────────────────────────────────

  return (
    <div className={embedded ? '' : 'max-w-7xl mx-auto px-4 py-6'}>
      {/* Header */}
      {!embedded && (
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
      )}

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
                  <span className="ml-1 inline-flex">
                    <InfoTooltip text="Select all pages in this course for evaluation." />
                  </span>
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

            <button
              onClick={startEvaluation}
              disabled={running || selectedPageIds.size === 0 || rubrics.length === 0}
              className="w-full py-2.5 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
            >
              {running
                ? 'Evaluating...'
                : `Evaluate ${selectedPageIds.size} Page${selectedPageIds.size !== 1 ? 's' : ''}`}
              <span className="ml-1 inline-flex">
                <InfoTooltip text="Run AI evaluation of selected pages against configured rubrics. Triggers an LLM call." />
              </span>
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
                    className="text-xs px-3 py-1.5 bg-gray-100 text-gray-600 rounded hover:bg-gray-200 flex items-center gap-1"
                  >
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M12 10v6m0 0l-3-3m3 3l3-3m2 8H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
                      />
                    </svg>
                    Export PDF
                    <span className="ml-1 inline-flex">
                      <InfoTooltip text="Generate a printable PDF evaluation report with scores and issues." />
                    </span>
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
                    onClick={() => {
                      setSelectedPageResult(result);
                      setApplyingIndex(null);
                    }}
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
                      <p className="text-xs text-red-500">Error: {result.scores.message}</p>
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
                <div className="border border-gray-200 rounded-lg bg-white">
                  {/* Report Header */}
                  <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Detailed Report: {selectedPageResult.itemTitle}
                    </h3>
                    <div className="flex gap-2">
                      {!selectedPageResult.fixesApplied &&
                        selectedPageResult.issues.some((i) => i.autoFixable) && (
                          <button
                            onClick={async () => {
                              const res = await handleApplyAllFixes(selectedPageResult.id);
                              if (res && !res.applied) {
                                // no-op, already refreshed
                              }
                            }}
                            className="text-xs px-3 py-1.5 bg-emerald-600 text-white rounded hover:bg-emerald-700"
                          >
                            Apply All Auto-Fixes
                            <span className="ml-1 inline-flex">
                              <InfoTooltip
                                text="Automatically apply all AI-suggested content fixes. This modifies page content directly."
                                warn={true}
                              />
                            </span>
                          </button>
                        )}
                    </div>
                  </div>

                  {/* Scores */}
                  <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-2">
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

                  {/* Fix feedback message */}
                  {fixMessage && (
                    <div className="mx-4 mt-3 px-3 py-2 rounded text-xs bg-blue-50 text-blue-700 border border-blue-200">
                      {fixMessage}
                    </div>
                  )}

                  {/* Issues List */}
                  <div>
                    {selectedPageResult.issues.length > 0 ? (
                      <div>
                        {/* Column headers */}
                        <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                          <div className="w-16">Severity</div>
                          <div className="w-20">Category</div>
                          <div className="w-40">Location</div>
                          <div className="flex-1">Issue</div>
                          <div className="w-32 text-right">Actions</div>
                        </div>
                        {selectedPageResult.issues.map((issue, idx) => (
                          <IssueRow
                            key={idx}
                            issue={issue}
                            index={idx}
                            onApplyFix={
                              issue.autoFixable && !selectedPageResult.fixesApplied
                                ? handleApplySingleFix
                                : null
                            }
                            applyingIndex={applyingIndex}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="p-4 text-sm text-gray-400">No issues found for this page.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ─── History Tab ───────────────────────────────── */}
      {tab === 'history' && (
        <div>
          {historySelectedRun && (
            <button
              onClick={() => {
                setHistorySelectedRun(null);
                setHistoryPageResult(null);
              }}
              className="mb-3 text-xs text-indigo-600 hover:underline"
            >
              &larr; Back to all runs
            </button>
          )}

          {/* Run list */}
          {!historySelectedRun && (
            <>
              {pastRuns.length === 0 ? (
                <p className="text-center py-12 text-sm text-gray-400">No past evaluation runs.</p>
              ) : (
                <div className="space-y-3">
                  {pastRuns.map((run) => (
                    <div
                      key={run.id}
                      className="border border-gray-200 rounded-lg bg-white p-4 hover:bg-gray-50 cursor-pointer"
                      onClick={async () => {
                        if (!courseId) return;
                        try {
                          const fullRun = await apiFetch<EvalRun>(
                            `/courses/${courseId}/evaluation/runs/${run.id}`,
                          );
                          setHistorySelectedRun(fullRun);
                          setHistoryPageResult(null);
                        } catch {
                          /* silent */
                        }
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
                            {formatDateTimeSGT(run.createdAt)}
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
            </>
          )}

          {/* Expanded run detail (inline) */}
          {historySelectedRun && (
            <div>
              {/* Summary */}
              <div className="border border-gray-200 rounded-lg bg-white p-4 mb-4">
                <div className="flex items-center gap-3 mb-3">
                  <h2 className="text-sm font-semibold text-gray-700">Run Summary</h2>
                  <span
                    className={`px-2 py-0.5 rounded text-xs font-medium ${
                      historySelectedRun.status === 'COMPLETED'
                        ? 'bg-green-100 text-green-700'
                        : historySelectedRun.status === 'FAILED'
                          ? 'bg-red-100 text-red-700'
                          : 'bg-gray-100 text-gray-600'
                    }`}
                  >
                    {historySelectedRun.status}
                  </span>
                  <span className="text-xs text-gray-400">
                    {formatDateTimeSGT(historySelectedRun.createdAt)}
                  </span>
                </div>
                {historySelectedRun.summary && (
                  <div className="flex flex-wrap gap-2">
                    {Object.entries(historySelectedRun.summary).map(([key, val]) => (
                      <ScoreBadge
                        key={key}
                        label={key.charAt(0).toUpperCase() + key.slice(1)}
                        score={val}
                      />
                    ))}
                  </div>
                )}
              </div>

              {/* Page cards */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3 mb-4">
                {historySelectedRun.results.map((result) => (
                  <button
                    key={result.id}
                    onClick={() => setHistoryPageResult(result)}
                    className={`text-left border rounded-lg p-3 transition-colors ${
                      historyPageResult?.id === result.id
                        ? 'border-indigo-400 bg-indigo-50'
                        : 'border-gray-200 bg-white hover:bg-gray-50'
                    }`}
                  >
                    <span className="text-sm font-medium text-gray-700 truncate block">
                      {result.itemTitle}
                    </span>
                    {result.scores.error ? (
                      <p className="text-xs text-red-500">Error: {result.scores.message}</p>
                    ) : (
                      <div className="flex flex-wrap gap-1 mt-1">
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

              {/* Selected page detail */}
              {historyPageResult && (
                <div className="border border-gray-200 rounded-lg bg-white">
                  <div className="px-4 py-3 border-b border-gray-200">
                    <h3 className="text-sm font-semibold text-gray-700">
                      Detailed Report: {historyPageResult.itemTitle}
                    </h3>
                  </div>
                  <div className="px-4 py-3 border-b border-gray-100 flex flex-wrap gap-2">
                    {Object.entries(historyPageResult.scores)
                      .filter(([k]) => k !== 'error' && k !== 'message')
                      .map(([key, val]) => (
                        <ScoreBadge
                          key={key}
                          label={key.charAt(0).toUpperCase() + key.slice(1)}
                          score={val as number}
                        />
                      ))}
                  </div>
                  <div>
                    {historyPageResult.issues.length > 0 ? (
                      <div>
                        <div className="flex items-center gap-3 px-3 py-2 bg-gray-50 border-b border-gray-200 text-[10px] font-semibold text-gray-500 uppercase tracking-wider">
                          <div className="w-16">Severity</div>
                          <div className="w-20">Category</div>
                          <div className="w-40">Location</div>
                          <div className="flex-1">Issue</div>
                          <div className="w-32 text-right">Actions</div>
                        </div>
                        {historyPageResult.issues.map((issue, idx) => (
                          <IssueRow
                            key={idx}
                            issue={issue}
                            index={idx}
                            onApplyFix={null}
                            applyingIndex={null}
                          />
                        ))}
                      </div>
                    ) : (
                      <p className="p-4 text-sm text-gray-400">No issues found for this page.</p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
