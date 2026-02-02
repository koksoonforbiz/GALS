import { useState, useEffect, useCallback, useRef } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';

// ─── Types ──────────────────────────────────────────────

interface KcEvalScope {
  type: 'course' | 'pages';
  pageIds?: string[];
}

type KcEvalDepth = 'quick' | 'deep';

interface KcEvalSummary {
  totalKCs: number;
  wellSupportedKCs: number;
  weakKCs: number;
  missingKCs: number;
  prerequisiteViolations: number;
  overloadedPages: number;
  outcomeMismatches: number;
  totalRecommendations: number;
}

interface KcFinding {
  kcId: string;
  kcName: string;
  status: 'well_supported' | 'weak' | 'missing';
  evidenceCount: number;
  highStrengthCount: number;
  mediumStrengthCount: number;
  lowStrengthCount: number;
  issues: Array<{
    type: string;
    description: string;
    severity: 'error' | 'warning' | 'info';
    relatedPageIds?: string[];
  }>;
}

interface PageIssueDetail {
  type: string;
  description: string;
  relatedKCs: Array<{ id: string; name: string }>;
  severity: 'error' | 'warning' | 'info';
}

interface PageFinding {
  pageId: string;
  pageTitle: string;
  moduleName: string;
  issues: PageIssueDetail[];
}

interface Recommendation {
  type: string;
  target: string;
  targetId?: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

interface KcEvalOutput {
  summary: KcEvalSummary;
  kcFindings: KcFinding[];
  pageFindings: PageFinding[];
  recommendations: Recommendation[];
  metadata: {
    courseId: string;
    depth: string;
    evaluatedAt: string;
    pagesEvaluated: number;
    totalApprovedKCs: number;
  };
}

interface KcEvalRun {
  id: string;
  courseId: string;
  status: string;
  scope: KcEvalScope;
  depth: string;
  results: KcEvalOutput | null;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface RunListItem {
  id: string;
  status: string;
  scope: KcEvalScope;
  depth: string;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
}

interface PageTreeModule {
  moduleId: string;
  moduleTitle: string;
  pages: Array<{ id: string; title: string }>;
}

interface Props {
  courseId: string;
}

// ─── Sub-views ──────────────────────────────────────────

type ViewMode = 'setup' | 'results' | 'history' | 'kc-drill' | 'page-drill';

// ─── Component ──────────────────────────────────────────

export default function KcEvaluationDashboard({ courseId }: Props) {
  const { toast } = useToast();

  // View state
  const [view, setView] = useState<ViewMode>('setup');
  const [activeRun, setActiveRun] = useState<KcEvalRun | null>(null);
  const [pastRuns, setPastRuns] = useState<RunListItem[]>([]);
  const [polling, setPolling] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Setup state
  const [scopeType, setScopeType] = useState<'course' | 'pages'>('course');
  const [selectedPageIds, setSelectedPageIds] = useState<Set<string>>(new Set());
  const [depth, setDepth] = useState<KcEvalDepth>('quick');
  const [running, setRunning] = useState(false);
  const [pageTree, setPageTree] = useState<PageTreeModule[]>([]);

  // Drill-down state
  const [selectedKcId, setSelectedKcId] = useState<string | null>(null);
  const [selectedPageId, setSelectedPageId] = useState<string | null>(null);

  // ─── Data fetching ────────────────────────────────────

  const fetchPageTree = useCallback(async () => {
    try {
      const tree = await apiFetch<PageTreeModule[]>(
        `/courses/${courseId}/evaluation/tree`,
      );
      setPageTree(tree);
    } catch { /* tree is only needed for page selection */ }
  }, [courseId]);

  const fetchPastRuns = useCallback(async () => {
    try {
      const runs = await apiFetch<RunListItem[]>(
        `/courses/${courseId}/kc-evaluation/runs`,
      );
      setPastRuns(runs);
    } catch { /* non-critical */ }
  }, [courseId]);

  useEffect(() => {
    fetchPageTree();
    fetchPastRuns();
  }, [fetchPageTree, fetchPastRuns]);

  // Polling for active run
  useEffect(() => {
    if (!polling || !activeRun) return;
    pollRef.current = setInterval(async () => {
      try {
        const run = await apiFetch<KcEvalRun>(
          `/courses/${courseId}/kc-evaluation/runs/${activeRun.id}`,
        );
        setActiveRun(run);
        if (run.status === 'COMPLETED' || run.status === 'FAILED') {
          setPolling(false);
          if (run.status === 'COMPLETED') {
            setView('results');
            toast('success', 'KC evaluation completed');
          } else {
            toast('error', run.errorMessage || 'Evaluation failed');
          }
          fetchPastRuns();
        }
      } catch {
        setPolling(false);
      }
    }, 2000);
    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [polling, activeRun, courseId, toast, fetchPastRuns]);

  // ─── Actions ──────────────────────────────────────────

  const handleStartEval = async () => {
    setRunning(true);
    try {
      const scope: KcEvalScope =
        scopeType === 'pages'
          ? { type: 'pages', pageIds: Array.from(selectedPageIds) }
          : { type: 'course' };
      const result = await apiFetch<{ runId: string; status: string }>(
        `/courses/${courseId}/kc-evaluation/run`,
        { method: 'POST', body: JSON.stringify({ scope, depth }) },
      );
      const run = await apiFetch<KcEvalRun>(
        `/courses/${courseId}/kc-evaluation/runs/${result.runId}`,
      );
      setActiveRun(run);
      setPolling(true);
      setView('results');
    } catch (err: any) {
      toast('error', err.message || 'Failed to start evaluation');
    } finally {
      setRunning(false);
    }
  };

  const handleViewRun = async (runId: string) => {
    try {
      const run = await apiFetch<KcEvalRun>(
        `/courses/${courseId}/kc-evaluation/runs/${runId}`,
      );
      setActiveRun(run);
      setView('results');
    } catch (err: any) {
      toast('error', err.message || 'Failed to load run');
    }
  };

  const handleExportJson = () => {
    if (!activeRun?.results) return;
    const blob = new Blob([JSON.stringify(activeRun.results, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `kc-evaluation-${activeRun.id.slice(0, 8)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleExportPdf = () => {
    if (!activeRun?.results) return;
    const r = activeRun.results;
    const html = buildPdfHtml(r);
    const win = window.open('', '_blank');
    if (win) {
      win.document.write(html);
      win.document.close();
      setTimeout(() => win.print(), 500);
    }
  };

  const handleDrillKc = (kcId: string) => {
    setSelectedKcId(kcId);
    setView('kc-drill');
  };

  const handleDrillPage = (pageId: string) => {
    setSelectedPageId(pageId);
    setView('page-drill');
  };

  // ─── Helpers ──────────────────────────────────────────

  const results = activeRun?.results || null;

  const togglePage = (pageId: string) => {
    setSelectedPageIds((prev) => {
      const next = new Set(prev);
      if (next.has(pageId)) next.delete(pageId);
      else next.add(pageId);
      return next;
    });
  };

  // ─── Render ───────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Navigation */}
      <div className="flex gap-2 border-b pb-2">
        {(['setup', 'results', 'history'] as ViewMode[]).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-3 py-1.5 text-sm rounded-t transition-colors ${
              view === v || (view === 'kc-drill' && v === 'results') || (view === 'page-drill' && v === 'results')
                ? 'bg-indigo-600 text-white'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
          >
            {v === 'setup' ? 'Setup' : v === 'results' ? 'Results' : 'History'}
          </button>
        ))}
        {polling && (
          <span className="ml-auto text-xs text-indigo-600 animate-pulse self-center">
            Evaluating...
          </span>
        )}
      </div>

      {/* ── SETUP VIEW ── */}
      {view === 'setup' && (
        <div className="space-y-4 max-w-2xl">
          <h3 className="text-lg font-semibold text-gray-800">Evaluate Course (KC-Aware)</h3>

          {/* Scope */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Scope</label>
            <div className="flex gap-2">
              <button
                onClick={() => setScopeType('course')}
                className={`px-4 py-2 text-sm rounded-lg border ${
                  scopeType === 'course' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Entire Course
              </button>
              <button
                onClick={() => setScopeType('pages')}
                className={`px-4 py-2 text-sm rounded-lg border ${
                  scopeType === 'pages' ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                }`}
              >
                Selected Pages
              </button>
            </div>
          </div>

          {/* Page selector */}
          {scopeType === 'pages' && (
            <div className="border rounded-lg p-3 max-h-64 overflow-y-auto space-y-2">
              {pageTree.length === 0 ? (
                <p className="text-sm text-gray-400">Loading page tree...</p>
              ) : (
                pageTree.map((mod) => (
                  <div key={mod.moduleId}>
                    <div className="text-xs font-semibold text-gray-500 mb-1">{mod.moduleTitle}</div>
                    {mod.pages.map((page) => (
                      <label key={page.id} className="flex items-center gap-2 text-sm py-0.5 cursor-pointer hover:bg-gray-50 px-1 rounded">
                        <input
                          type="checkbox"
                          checked={selectedPageIds.has(page.id)}
                          onChange={() => togglePage(page.id)}
                          className="rounded border-gray-300"
                        />
                        {page.title}
                      </label>
                    ))}
                  </div>
                ))
              )}
            </div>
          )}

          {/* Depth */}
          <div>
            <label className="text-sm font-medium text-gray-700 block mb-2">Evaluation Depth</label>
            <div className="flex gap-2">
              {(['quick', 'deep'] as KcEvalDepth[]).map((d) => (
                <button
                  key={d}
                  onClick={() => setDepth(d)}
                  className={`px-4 py-2 text-sm rounded-lg border ${
                    depth === d ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-700 border-gray-300 hover:bg-gray-50'
                  }`}
                >
                  {d === 'quick' ? 'Quick Scan' : 'Deep Analysis'}
                </button>
              ))}
            </div>
            <p className="text-xs text-gray-500 mt-1">
              {depth === 'quick'
                ? 'Fast pass: KC coverage, basic prerequisite checks, high-level signals.'
                : 'Thorough: lower thresholds, difficulty clustering, detailed outcome mapping.'}
            </p>
          </div>

          {/* Start */}
          <button
            onClick={handleStartEval}
            disabled={running || (scopeType === 'pages' && selectedPageIds.size === 0)}
            className="px-6 py-2.5 bg-indigo-600 text-white text-sm rounded-lg hover:bg-indigo-700 disabled:opacity-50"
          >
            {running ? 'Starting...' : 'Run KC Evaluation'}
          </button>
        </div>
      )}

      {/* ── RESULTS VIEW ── */}
      {view === 'results' && results && (
        <ResultsView
          results={results}
          onDrillKc={handleDrillKc}
          onDrillPage={handleDrillPage}
          onExportJson={handleExportJson}
          onExportPdf={handleExportPdf}
        />
      )}
      {view === 'results' && !results && activeRun && (
        <div className="text-center py-12">
          {activeRun.status === 'RUNNING' ? (
            <div className="text-indigo-600 animate-pulse">Evaluation in progress...</div>
          ) : activeRun.status === 'FAILED' ? (
            <div className="text-red-600">Evaluation failed: {activeRun.errorMessage}</div>
          ) : (
            <div className="text-gray-400">No results yet. Run an evaluation from the Setup tab.</div>
          )}
        </div>
      )}
      {view === 'results' && !results && !activeRun && (
        <div className="text-center py-12 text-gray-400">
          No evaluation results. Run one from the Setup tab.
        </div>
      )}

      {/* ── KC DRILL-DOWN ── */}
      {view === 'kc-drill' && results && selectedKcId && (
        <KcDrillView
          results={results}
          kcId={selectedKcId}
          onBack={() => setView('results')}
          onDrillPage={handleDrillPage}
        />
      )}

      {/* ── PAGE DRILL-DOWN ── */}
      {view === 'page-drill' && results && selectedPageId && (
        <PageDrillView
          results={results}
          pageId={selectedPageId}
          onBack={() => setView('results')}
          onDrillKc={handleDrillKc}
        />
      )}

      {/* ── HISTORY VIEW ── */}
      {view === 'history' && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-gray-800">Past Evaluations</h3>
          {pastRuns.length === 0 ? (
            <p className="text-gray-400 text-sm">No past evaluation runs.</p>
          ) : (
            <div className="space-y-2">
              {pastRuns.map((run) => (
                <button
                  key={run.id}
                  onClick={() => handleViewRun(run.id)}
                  className="w-full text-left border rounded-lg p-3 hover:bg-gray-50 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <StatusBadge status={run.status} />
                    <span className="text-sm text-gray-700">
                      {run.scope.type === 'course' ? 'Full Course' : `${run.scope.pageIds?.length || 0} pages`}
                      {' — '}
                      {run.depth === 'deep' ? 'Deep Analysis' : 'Quick Scan'}
                    </span>
                    <span className="ml-auto text-xs text-gray-400">
                      {new Date(run.createdAt).toLocaleString()}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Sub-Components ─────────────────────────────────────

function StatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    COMPLETED: 'bg-green-100 text-green-700',
    RUNNING: 'bg-blue-100 text-blue-700',
    PENDING: 'bg-gray-100 text-gray-600',
    FAILED: 'bg-red-100 text-red-700',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
      {status}
    </span>
  );
}

function SeverityIcon({ severity }: { severity: string }) {
  if (severity === 'error') return <span className="text-red-500 text-lg leading-none">●</span>;
  if (severity === 'warning') return <span className="text-yellow-500 text-lg leading-none">●</span>;
  return <span className="text-blue-400 text-lg leading-none">●</span>;
}

// ─── Results View ───────────────────────────────────────

function ResultsView({
  results,
  onDrillKc,
  onDrillPage,
  onExportJson,
  onExportPdf,
}: {
  results: KcEvalOutput;
  onDrillKc: (id: string) => void;
  onDrillPage: (id: string) => void;
  onExportJson: () => void;
  onExportPdf: () => void;
}) {
  const s = results.summary;

  return (
    <div className="space-y-6">
      {/* Export toolbar */}
      <div className="flex items-center gap-2">
        <h3 className="text-lg font-semibold text-gray-800 flex-1">Evaluation Results</h3>
        <button onClick={onExportJson} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
          Export JSON
        </button>
        <button onClick={onExportPdf} className="px-3 py-1.5 text-xs bg-gray-100 text-gray-700 rounded hover:bg-gray-200">
          Export PDF
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <SummaryCard label="Total KCs" value={s.totalKCs} color="bg-blue-50 text-blue-700" />
        <SummaryCard label="Well Supported" value={s.wellSupportedKCs} color="bg-green-50 text-green-700" />
        <SummaryCard label="Weak KCs" value={s.weakKCs} color="bg-yellow-50 text-yellow-700" />
        <SummaryCard label="Missing KCs" value={s.missingKCs} color="bg-red-50 text-red-700" />
        <SummaryCard label="Prereq Violations" value={s.prerequisiteViolations} color={s.prerequisiteViolations > 0 ? 'bg-red-50 text-red-700' : 'bg-gray-50 text-gray-500'} />
        <SummaryCard label="Overloaded Pages" value={s.overloadedPages} color={s.overloadedPages > 0 ? 'bg-orange-50 text-orange-700' : 'bg-gray-50 text-gray-500'} />
        <SummaryCard label="Outcome Mismatches" value={s.outcomeMismatches} color={s.outcomeMismatches > 0 ? 'bg-purple-50 text-purple-700' : 'bg-gray-50 text-gray-500'} />
        <SummaryCard label="Recommendations" value={s.totalRecommendations} color="bg-indigo-50 text-indigo-700" />
      </div>

      {/* KC health overview */}
      <div>
        <h4 className="text-sm font-semibold text-gray-700 mb-2">KC Health Overview</h4>
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-3 py-2 font-medium text-gray-600">KC</th>
                <th className="text-left px-3 py-2 font-medium text-gray-600">Status</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600">Evidence</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600">H/M/L</th>
                <th className="text-center px-3 py-2 font-medium text-gray-600">Issues</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {results.kcFindings.map((kf) => (
                <tr
                  key={kf.kcId}
                  onClick={() => onDrillKc(kf.kcId)}
                  className="hover:bg-gray-50 cursor-pointer"
                >
                  <td className="px-3 py-2 font-medium text-gray-900">{kf.kcName}</td>
                  <td className="px-3 py-2">
                    <KcStatusBadge status={kf.status} />
                  </td>
                  <td className="px-3 py-2 text-center">{kf.evidenceCount}</td>
                  <td className="px-3 py-2 text-center text-xs">
                    <span className="text-green-600">{kf.highStrengthCount}</span>/
                    <span className="text-yellow-600">{kf.mediumStrengthCount}</span>/
                    <span className="text-red-600">{kf.lowStrengthCount}</span>
                  </td>
                  <td className="px-3 py-2 text-center">
                    {kf.issues.length > 0 ? (
                      <span className="text-red-600 font-medium">{kf.issues.length}</span>
                    ) : (
                      <span className="text-green-500">0</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Page findings */}
      {results.pageFindings.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Page Issues ({results.pageFindings.length})</h4>
          <div className="space-y-2">
            {results.pageFindings.map((pf) => (
              <button
                key={pf.pageId}
                onClick={() => onDrillPage(pf.pageId)}
                className="w-full text-left border rounded-lg p-3 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-sm font-medium text-gray-900">{pf.pageTitle}</span>
                  <span className="text-xs text-gray-400">{pf.moduleName}</span>
                  <span className="ml-auto text-xs text-red-600 font-medium">{pf.issues.length} issue(s)</span>
                </div>
                <div className="flex gap-1 flex-wrap">
                  {pf.issues.slice(0, 3).map((iss, i) => (
                    <span key={i} className="flex items-center gap-1">
                      <SeverityIcon severity={iss.severity} />
                      <span className="text-xs text-gray-600">{iss.type.replace(/_/g, ' ')}</span>
                    </span>
                  ))}
                  {pf.issues.length > 3 && (
                    <span className="text-xs text-gray-400">+{pf.issues.length - 3} more</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Recommendations */}
      {results.recommendations.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Recommendations</h4>
          <div className="space-y-2">
            {results.recommendations.map((rec, i) => (
              <div key={i} className="border rounded-lg p-3 flex gap-3 items-start">
                <PriorityBadge priority={rec.priority} />
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-medium text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded">
                      {rec.type.replace(/_/g, ' ')}
                    </span>
                    <span className="text-sm font-medium text-gray-800">{rec.target}</span>
                  </div>
                  <p className="text-xs text-gray-600 mt-1">{rec.rationale}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Metadata */}
      <div className="text-xs text-gray-400 pt-2 border-t">
        Evaluated {results.metadata.pagesEvaluated} pages, {results.metadata.totalApprovedKCs} approved KCs
        {' — '}{results.metadata.depth} analysis at {new Date(results.metadata.evaluatedAt).toLocaleString()}
      </div>
    </div>
  );
}

// ─── KC Drill-Down ──────────────────────────────────────

function KcDrillView({
  results,
  kcId,
  onBack,
  onDrillPage,
}: {
  results: KcEvalOutput;
  kcId: string;
  onBack: () => void;
  onDrillPage: (id: string) => void;
}) {
  const kf = results.kcFindings.find((k) => k.kcId === kcId);
  if (!kf) return <div className="text-gray-400">KC not found.</div>;

  // Find pages that mention this KC
  const relatedPages = results.pageFindings.filter((pf) =>
    pf.issues.some((iss) => iss.relatedKCs.some((k) => k.id === kcId)),
  );

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-indigo-600 hover:underline">
        &larr; Back to results
      </button>
      <div className="flex items-center gap-3">
        <h3 className="text-lg font-semibold text-gray-800">{kf.kcName}</h3>
        <KcStatusBadge status={kf.status} />
      </div>

      {/* Stats */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard label="Total Mappings" value={kf.evidenceCount} color="bg-blue-50 text-blue-700" />
        <SummaryCard label="High Strength" value={kf.highStrengthCount} color="bg-green-50 text-green-700" />
        <SummaryCard label="Medium" value={kf.mediumStrengthCount} color="bg-yellow-50 text-yellow-700" />
        <SummaryCard label="Low" value={kf.lowStrengthCount} color="bg-red-50 text-red-700" />
      </div>

      {/* Issues */}
      {kf.issues.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Issues</h4>
          <div className="space-y-2">
            {kf.issues.map((iss, i) => (
              <div key={i} className="border rounded-lg p-3 flex items-start gap-2">
                <SeverityIcon severity={iss.severity} />
                <div>
                  <span className="text-xs font-medium text-gray-500">{iss.type.replace(/_/g, ' ')}</span>
                  <p className="text-sm text-gray-700">{iss.description}</p>
                  {iss.relatedPageIds && iss.relatedPageIds.length > 0 && (
                    <div className="flex gap-1 mt-1 flex-wrap">
                      {iss.relatedPageIds.map((pid) => {
                        const pf = results.pageFindings.find((p) => p.pageId === pid);
                        return (
                          <button
                            key={pid}
                            onClick={() => onDrillPage(pid)}
                            className="text-xs text-indigo-600 hover:underline"
                          >
                            {pf?.pageTitle || pid.slice(0, 8)}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Related page findings */}
      {relatedPages.length > 0 && (
        <div>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Related Page Issues</h4>
          <div className="space-y-1">
            {relatedPages.map((pf) => (
              <button
                key={pf.pageId}
                onClick={() => onDrillPage(pf.pageId)}
                className="w-full text-left px-3 py-2 border rounded hover:bg-gray-50 text-sm"
              >
                <span className="font-medium">{pf.pageTitle}</span>
                <span className="text-gray-400 text-xs ml-2">
                  {pf.issues.filter((i) => i.relatedKCs.some((k) => k.id === kcId)).length} issue(s) involving this KC
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Page Drill-Down ────────────────────────────────────

function PageDrillView({
  results,
  pageId,
  onBack,
  onDrillKc,
}: {
  results: KcEvalOutput;
  pageId: string;
  onBack: () => void;
  onDrillKc: (id: string) => void;
}) {
  const pf = results.pageFindings.find((p) => p.pageId === pageId);
  if (!pf) return <div className="text-gray-400">Page not found in findings.</div>;

  return (
    <div className="space-y-4">
      <button onClick={onBack} className="text-sm text-indigo-600 hover:underline">
        &larr; Back to results
      </button>
      <div>
        <h3 className="text-lg font-semibold text-gray-800">{pf.pageTitle}</h3>
        <span className="text-sm text-gray-500">{pf.moduleName}</span>
      </div>

      {/* Issues */}
      <div className="space-y-2">
        {pf.issues.map((iss, i) => (
          <div key={i} className="border rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1">
              <SeverityIcon severity={iss.severity} />
              <span className="text-xs font-medium text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                {iss.type.replace(/_/g, ' ')}
              </span>
              <span className={`text-xs font-medium ${
                iss.severity === 'error' ? 'text-red-600' : iss.severity === 'warning' ? 'text-yellow-600' : 'text-blue-500'
              }`}>
                {iss.severity}
              </span>
            </div>
            <p className="text-sm text-gray-700">{iss.description}</p>
            {iss.relatedKCs.length > 0 && (
              <div className="flex gap-1 mt-2 flex-wrap">
                <span className="text-xs text-gray-400">Related KCs:</span>
                {iss.relatedKCs.map((kc) => (
                  <button
                    key={kc.id}
                    onClick={() => onDrillKc(kc.id)}
                    className="text-xs bg-indigo-50 text-indigo-700 px-2 py-0.5 rounded hover:bg-indigo-100"
                  >
                    {kc.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Tiny Components ────────────────────────────────────

function SummaryCard({ label, value, color }: { label: string; value: number; color: string }) {
  return (
    <div className={`rounded-lg p-3 text-center ${color}`}>
      <div className="text-2xl font-bold">{value}</div>
      <div className="text-xs">{label}</div>
    </div>
  );
}

function KcStatusBadge({ status }: { status: string }) {
  const colors: Record<string, string> = {
    well_supported: 'bg-green-100 text-green-700',
    weak: 'bg-yellow-100 text-yellow-700',
    missing: 'bg-red-100 text-red-700',
  };
  const labels: Record<string, string> = {
    well_supported: 'Well Supported',
    weak: 'Weak',
    missing: 'Missing',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] || 'bg-gray-100'}`}>
      {labels[status] || status}
    </span>
  );
}

function PriorityBadge({ priority }: { priority: string }) {
  const colors: Record<string, string> = {
    high: 'bg-red-100 text-red-700',
    medium: 'bg-yellow-100 text-yellow-700',
    low: 'bg-blue-100 text-blue-600',
  };
  return (
    <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[priority] || ''}`}>
      {priority.toUpperCase()}
    </span>
  );
}

// ─── PDF Export HTML Builder ────────────────────────────

function buildPdfHtml(r: KcEvalOutput): string {
  const s = r.summary;
  const kcRows = r.kcFindings
    .map(
      (kf) =>
        `<tr>
          <td>${kf.kcName}</td>
          <td>${kf.status.replace(/_/g, ' ')}</td>
          <td>${kf.evidenceCount}</td>
          <td>${kf.highStrengthCount}/${kf.mediumStrengthCount}/${kf.lowStrengthCount}</td>
          <td>${kf.issues.length}</td>
        </tr>`,
    )
    .join('');

  const pageRows = r.pageFindings
    .map(
      (pf) =>
        `<tr>
          <td>${pf.pageTitle}</td>
          <td>${pf.moduleName}</td>
          <td>${pf.issues.map((i) => `<div><strong>${i.type.replace(/_/g, ' ')}</strong> (${i.severity}): ${i.description}</div>`).join('')}</td>
        </tr>`,
    )
    .join('');

  const recRows = r.recommendations
    .map(
      (rec) =>
        `<tr>
          <td><span class="priority-${rec.priority}">${rec.priority.toUpperCase()}</span></td>
          <td>${rec.type.replace(/_/g, ' ')}</td>
          <td>${rec.target}</td>
          <td>${rec.rationale}</td>
        </tr>`,
    )
    .join('');

  return `<!DOCTYPE html>
<html>
<head>
  <title>KC Evaluation Report</title>
  <style>
    body { font-family: -apple-system, sans-serif; padding: 40px; max-width: 900px; margin: auto; color: #1a1a1a; }
    h1 { font-size: 24px; border-bottom: 2px solid #4f46e5; padding-bottom: 8px; }
    h2 { font-size: 18px; color: #4f46e5; margin-top: 32px; }
    table { width: 100%; border-collapse: collapse; margin: 12px 0; font-size: 13px; }
    th, td { border: 1px solid #e5e7eb; padding: 6px 10px; text-align: left; }
    th { background: #f3f4f6; font-weight: 600; }
    .stats { display: grid; grid-template-columns: repeat(4, 1fr); gap: 12px; margin: 16px 0; }
    .stat { background: #f9fafb; border-radius: 8px; padding: 12px; text-align: center; }
    .stat .value { font-size: 28px; font-weight: 700; }
    .stat .label { font-size: 11px; color: #6b7280; }
    .priority-high { color: #dc2626; font-weight: 600; }
    .priority-medium { color: #d97706; font-weight: 600; }
    .priority-low { color: #2563eb; }
    @media print { body { padding: 20px; } }
  </style>
</head>
<body>
  <h1>KC-Aware Evaluation Report</h1>
  <p style="color:#6b7280; font-size:13px;">
    ${r.metadata.depth} analysis — ${r.metadata.pagesEvaluated} pages, ${r.metadata.totalApprovedKCs} KCs
    — ${new Date(r.metadata.evaluatedAt).toLocaleString()}
  </p>

  <div class="stats">
    <div class="stat"><div class="value">${s.totalKCs}</div><div class="label">Total KCs</div></div>
    <div class="stat"><div class="value" style="color:#16a34a">${s.wellSupportedKCs}</div><div class="label">Well Supported</div></div>
    <div class="stat"><div class="value" style="color:#d97706">${s.weakKCs}</div><div class="label">Weak</div></div>
    <div class="stat"><div class="value" style="color:#dc2626">${s.missingKCs}</div><div class="label">Missing</div></div>
  </div>
  <div class="stats">
    <div class="stat"><div class="value">${s.prerequisiteViolations}</div><div class="label">Prereq Violations</div></div>
    <div class="stat"><div class="value">${s.overloadedPages}</div><div class="label">Overloaded Pages</div></div>
    <div class="stat"><div class="value">${s.outcomeMismatches}</div><div class="label">Outcome Mismatches</div></div>
    <div class="stat"><div class="value">${s.totalRecommendations}</div><div class="label">Recommendations</div></div>
  </div>

  <h2>KC Health</h2>
  <table>
    <thead><tr><th>KC</th><th>Status</th><th>Evidence</th><th>H/M/L</th><th>Issues</th></tr></thead>
    <tbody>${kcRows}</tbody>
  </table>

  ${r.pageFindings.length > 0 ? `
  <h2>Page Issues</h2>
  <table>
    <thead><tr><th>Page</th><th>Module</th><th>Issues</th></tr></thead>
    <tbody>${pageRows}</tbody>
  </table>` : ''}

  ${r.recommendations.length > 0 ? `
  <h2>Recommendations</h2>
  <table>
    <thead><tr><th>Priority</th><th>Type</th><th>Target</th><th>Rationale</th></tr></thead>
    <tbody>${recRows}</tbody>
  </table>` : ''}
</body>
</html>`;
}
