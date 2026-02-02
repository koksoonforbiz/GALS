import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';

// ─── Types ──────────────────────────────────────────────

interface SyllabusOutcome {
  id: string;
  code: string;
  description: string;
  bloomLevel: string | null;
  category: string | null;
}

interface OutcomeKcMap {
  outcomeId: string;
  kcId: string;
  kcName: string;
  confidence: number;
  rationale: string;
}

interface CoverageSummary {
  totalOutcomes: number;
  mappedOutcomes: number;
  unmappedOutcomeCount: number;
  weaklyMappedOutcomeCount: number;
  totalApprovedKCs: number;
  kcsWithOutcomeLink: number;
  orphanKCs: number;
  overrepresentedKCCount: number;
  lateIntroducedKCCount: number;
  coveragePercent: number;
}

interface UnmappedOutcome {
  outcomeId: string;
  outcomeCode: string;
  description: string;
  reason: string;
}

interface WeaklyMappedOutcome {
  outcomeId: string;
  outcomeCode: string;
  description: string;
  bestConfidence: number;
  linkedKCs: Array<{ kcId: string; kcName: string; confidence: number }>;
}

interface OverrepresentedKC {
  kcId: string;
  kcName: string;
  outcomeCount: number;
  pageCount: number;
  linkedOutcomeIds: string[];
}

interface LateIntroducedKC {
  kcId: string;
  kcName: string;
  firstPageGlobalOrder: number;
  firstPageTitle: string;
  linkedOutcomeIds: string[];
  expectedEarlierBecause: string;
}

interface CoverageCell {
  outcomeId: string;
  outcomeCode: string;
  kcId: string;
  kcName: string;
  confidence: number;
  strength: string | null;
}

interface TimelineEntry {
  pageId: string;
  pageTitle: string;
  globalOrder: number;
  moduleTitle: string;
  kcIds: string[];
  outcomeIds: string[];
  newOutcomesCovered: string[];
}

interface CoverageRecommendation {
  type: string;
  target: string;
  targetId?: string;
  rationale: string;
  priority: 'high' | 'medium' | 'low';
}

interface CoverageResults {
  summary: CoverageSummary;
  unmappedOutcomes: UnmappedOutcome[];
  weaklyMappedOutcomes: WeaklyMappedOutcome[];
  overrepresentedKCs: OverrepresentedKC[];
  lateIntroducedKCs: LateIntroducedKC[];
  coverageMatrix: CoverageCell[];
  timeline: TimelineEntry[];
  recommendations: CoverageRecommendation[];
  metadata: { courseId: string; analyzedAt: string; totalPages: number; syllabusLength: number };
}

interface CoverageRun {
  id: string;
  status: string;
  syllabusText?: string;
  parsedOutcomes?: SyllabusOutcome[];
  outcomeKcMaps?: OutcomeKcMap[];
  coverageResults?: CoverageResults;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

interface RunListItem {
  id: string;
  status: string;
  errorMessage?: string;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

type View = 'setup' | 'results' | 'matrix' | 'timeline' | 'history';

// ─── Component ──────────────────────────────────────────

export default function CurriculumCoveragePanel({ courseId }: { courseId: string }) {
  const [view, setView] = useState<View>('setup');
  const [syllabusText, setSyllabusText] = useState('');
  const [running, setRunning] = useState(false);
  const [activeRun, setActiveRun] = useState<CoverageRun | null>(null);
  const [runs, setRuns] = useState<RunListItem[]>([]);
  const [error, setError] = useState<string | null>(null);

  const base = `/courses/${courseId}/curriculum-coverage`;

  // ─── Fetch runs list ──────────────────────────

  const fetchRuns = useCallback(async () => {
    try {
      const data = await apiFetch<RunListItem[]>(`${base}/runs`);
      setRuns(data);
    } catch {
      // silent
    }
  }, [base]);

  useEffect(() => {
    fetchRuns();
  }, [fetchRuns]);

  // ─── Poll for active run ──────────────────────

  useEffect(() => {
    if (!activeRun || (activeRun.status !== 'RUNNING' && activeRun.status !== 'PENDING')) return;
    const interval = setInterval(async () => {
      try {
        const data = await apiFetch<CoverageRun>(`${base}/runs/${activeRun.id}`);
        setActiveRun(data);
        if (data.status === 'COMPLETED' || data.status === 'FAILED') {
          setRunning(false);
          if (data.status === 'COMPLETED') setView('results');
          fetchRuns();
        }
      } catch {
        // silent
      }
    }, 2000);
    return () => clearInterval(interval);
  }, [activeRun, base, fetchRuns]);

  // ─── Start coverage run ───────────────────────

  const handleStart = async () => {
    if (!syllabusText.trim()) {
      setError('Please paste or type your syllabus text.');
      return;
    }
    setError(null);
    setRunning(true);
    try {
      const res = await apiFetch<{ runId: string; status: string }>(`${base}/run`, {
        method: 'POST',
        body: JSON.stringify({ syllabusText }),
      });
      const run = await apiFetch<CoverageRun>(`${base}/runs/${res.runId}`);
      setActiveRun(run);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start');
      setRunning(false);
    }
  };

  // ─── Load a historical run ────────────────────

  const loadRun = async (runId: string) => {
    try {
      const data = await apiFetch<CoverageRun>(`${base}/runs/${runId}`);
      setActiveRun(data);
      setView(data.status === 'COMPLETED' ? 'results' : 'setup');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load run');
    }
  };

  // ─── Re-analyze after manual changes ──────────

  const handleReanalyze = async () => {
    if (!activeRun) return;
    setRunning(true);
    try {
      const data = await apiFetch<CoverageRun>(`${base}/runs/${activeRun.id}/reanalyze`, {
        method: 'POST',
      });
      setActiveRun(data);
      setRunning(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Re-analysis failed');
      setRunning(false);
    }
  };

  // ─── Export ───────────────────────────────────

  const handleExportJson = () => {
    if (!activeRun) return;
    const token = localStorage.getItem('token');
    window.open(
      `/api${base}/runs/${activeRun.id}/export-json?token=${token}`,
      '_blank',
    );
  };

  const handleExportPdf = () => {
    if (!activeRun?.coverageResults) return;
    const r = activeRun.coverageResults;
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(buildPdfHtml(r, activeRun.parsedOutcomes || []));
    w.document.close();
    setTimeout(() => w.print(), 500);
  };

  // ─── Render ───────────────────────────────────

  const results = activeRun?.coverageResults;
  const outcomes = activeRun?.parsedOutcomes || [];
  const maps = activeRun?.outcomeKcMaps || [];

  const navTabs: { key: View; label: string; disabled?: boolean }[] = [
    { key: 'setup', label: 'Setup' },
    { key: 'results', label: 'Results', disabled: !results },
    { key: 'matrix', label: 'Coverage Matrix', disabled: !results },
    { key: 'timeline', label: 'Timeline', disabled: !results },
    { key: 'history', label: 'History' },
  ];

  return (
    <div className="max-w-6xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Curriculum Coverage & Gap Mapping</h3>
          <p className="text-sm text-gray-500">
            Analyze how well your course content covers the syllabus learning outcomes.
          </p>
        </div>
        {results && (
          <div className="flex gap-2">
            <button
              onClick={handleExportJson}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Export JSON
            </button>
            <button
              onClick={handleExportPdf}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Export PDF
            </button>
          </div>
        )}
      </div>

      {/* Sub-tabs */}
      <div className="flex gap-1 border-b border-gray-200 mb-4">
        {navTabs.map((t) => (
          <button
            key={t.key}
            onClick={() => !t.disabled && setView(t.key)}
            disabled={t.disabled}
            className={`px-3 py-1.5 text-xs font-medium border-b-2 transition-colors ${
              view === t.key
                ? 'border-teal-600 text-teal-600'
                : t.disabled
                  ? 'border-transparent text-gray-300 cursor-not-allowed'
                  : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">dismiss</button>
        </div>
      )}

      {/* ─── Setup View ─── */}
      {view === 'setup' && (
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Syllabus / Curriculum Text
            </label>
            <textarea
              value={syllabusText}
              onChange={(e) => setSyllabusText(e.target.value)}
              placeholder="Paste your course syllabus, curriculum document, or learning outcomes here..."
              className="w-full px-3 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-teal-500 focus:border-teal-500 font-mono text-sm"
              rows={12}
            />
            <p className="text-xs text-gray-400 mt-1">
              The system will extract learning outcomes, map them to Knowledge Components, and analyze coverage gaps.
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={handleStart}
              disabled={running || !syllabusText.trim()}
              className="px-4 py-2 text-sm bg-teal-600 text-white rounded-lg hover:bg-teal-700 disabled:opacity-50"
            >
              {running ? 'Analyzing...' : 'Analyze Coverage'}
            </button>
          </div>

          {/* Show parsed outcomes if available */}
          {outcomes.length > 0 && (
            <div className="mt-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">
                Parsed Outcomes ({outcomes.length})
              </h4>
              <div className="space-y-1 max-h-64 overflow-y-auto">
                {outcomes.map((o) => (
                  <div key={o.id} className="text-xs p-2 bg-gray-50 rounded flex items-start gap-2">
                    <span className="font-mono font-bold text-teal-700 shrink-0">{o.code}</span>
                    <span className="text-gray-700">{o.description}</span>
                    {o.bloomLevel && (
                      <span className="shrink-0 px-1.5 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px]">
                        {o.bloomLevel}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {running && (
            <div className="p-4 bg-teal-50 border border-teal-200 rounded-lg text-sm text-teal-700 animate-pulse">
              Running coverage analysis... This may take a moment.
            </div>
          )}

          {activeRun?.status === 'FAILED' && (
            <div className="p-4 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
              Analysis failed: {activeRun.errorMessage || 'Unknown error'}
            </div>
          )}
        </div>
      )}

      {/* ─── Results View ─── */}
      {view === 'results' && results && (
        <ResultsView
          results={results}
          outcomes={outcomes}
          maps={maps}
          onReanalyze={handleReanalyze}
          running={running}
        />
      )}

      {/* ─── Coverage Matrix View ─── */}
      {view === 'matrix' && results && (
        <MatrixView
          results={results}
          outcomes={outcomes}
        />
      )}

      {/* ─── Timeline View ─── */}
      {view === 'timeline' && results && (
        <TimelineView
          results={results}
          outcomes={outcomes}
        />
      )}

      {/* ─── History View ─── */}
      {view === 'history' && (
        <div className="space-y-2">
          <h4 className="text-sm font-semibold text-gray-700 mb-2">Past Runs</h4>
          {runs.length === 0 ? (
            <p className="text-sm text-gray-400">No coverage analysis runs yet.</p>
          ) : (
            runs.map((r) => (
              <div
                key={r.id}
                className="flex items-center justify-between p-3 bg-white border border-gray-200 rounded-lg hover:border-teal-300 cursor-pointer"
                onClick={() => loadRun(r.id)}
              >
                <div>
                  <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                    r.status === 'COMPLETED' ? 'bg-green-100 text-green-700' :
                    r.status === 'FAILED' ? 'bg-red-100 text-red-700' :
                    'bg-yellow-100 text-yellow-700'
                  }`}>
                    {r.status}
                  </span>
                  <span className="ml-2 text-sm text-gray-600">
                    {new Date(r.createdAt).toLocaleString()}
                  </span>
                </div>
                <span className="text-xs text-gray-400">View</span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

// ─── Results Sub-component ──────────────────────────────

function ResultsView({
  results,
  outcomes,
  maps,
  onReanalyze,
  running,
}: {
  results: CoverageResults;
  outcomes: SyllabusOutcome[];
  maps: OutcomeKcMap[];
  onReanalyze: () => void;
  running: boolean;
}) {
  const s = results.summary;

  return (
    <div className="space-y-6">
      {/* Summary Cards */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        <SummaryCard label="Coverage" value={`${s.coveragePercent}%`} color={s.coveragePercent >= 80 ? 'green' : s.coveragePercent >= 50 ? 'yellow' : 'red'} />
        <SummaryCard label="Outcomes" value={`${s.mappedOutcomes}/${s.totalOutcomes}`} color="blue" />
        <SummaryCard label="Unmapped" value={s.unmappedOutcomeCount} color={s.unmappedOutcomeCount > 0 ? 'red' : 'green'} />
        <SummaryCard label="Weak" value={s.weaklyMappedOutcomeCount} color={s.weaklyMappedOutcomeCount > 0 ? 'yellow' : 'green'} />
        <SummaryCard label="Orphan KCs" value={s.orphanKCs} color={s.orphanKCs > 0 ? 'yellow' : 'green'} />
        <SummaryCard label="KCs Linked" value={`${s.kcsWithOutcomeLink}/${s.totalApprovedKCs}`} color="blue" />
        <SummaryCard label="Overrep. KCs" value={s.overrepresentedKCCount} color={s.overrepresentedKCCount > 0 ? 'yellow' : 'green'} />
        <SummaryCard label="Late KCs" value={s.lateIntroducedKCCount} color={s.lateIntroducedKCCount > 0 ? 'red' : 'green'} />
      </div>

      {/* Coverage bar */}
      <div>
        <div className="flex justify-between text-xs text-gray-500 mb-1">
          <span>Curriculum Coverage</span>
          <span>{s.coveragePercent}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-3">
          <div
            className={`h-3 rounded-full transition-all ${
              s.coveragePercent >= 80 ? 'bg-green-500' :
              s.coveragePercent >= 50 ? 'bg-yellow-500' : 'bg-red-500'
            }`}
            style={{ width: `${s.coveragePercent}%` }}
          />
        </div>
      </div>

      {/* Re-analyze button */}
      <div className="flex gap-2">
        <button
          onClick={onReanalyze}
          disabled={running}
          className="text-xs px-3 py-1.5 bg-teal-100 text-teal-700 rounded hover:bg-teal-200 disabled:opacity-50"
        >
          {running ? 'Re-analyzing...' : 'Re-analyze (after edits)'}
        </button>
      </div>

      {/* Unmapped Outcomes */}
      {results.unmappedOutcomes.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold text-red-700 mb-2">
            Unmapped Outcomes ({results.unmappedOutcomes.length})
          </h4>
          <div className="space-y-1">
            {results.unmappedOutcomes.map((u) => (
              <div key={u.outcomeId} className="p-2 bg-red-50 border border-red-200 rounded text-xs">
                <span className="font-mono font-bold text-red-700">{u.outcomeCode}</span>
                <span className="ml-2 text-gray-700">{u.description}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Weakly Mapped Outcomes */}
      {results.weaklyMappedOutcomes.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold text-yellow-700 mb-2">
            Weakly Mapped Outcomes ({results.weaklyMappedOutcomes.length})
          </h4>
          <div className="space-y-1">
            {results.weaklyMappedOutcomes.map((w) => (
              <div key={w.outcomeId} className="p-2 bg-yellow-50 border border-yellow-200 rounded text-xs">
                <div>
                  <span className="font-mono font-bold text-yellow-700">{w.outcomeCode}</span>
                  <span className="ml-2 text-gray-700">{w.description}</span>
                </div>
                <div className="mt-1 text-gray-500">
                  Best confidence: {Math.round(w.bestConfidence * 100)}% — KCs:{' '}
                  {w.linkedKCs.map((k) => `${k.kcName} (${Math.round(k.confidence * 100)}%)`).join(', ')}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Overrepresented KCs */}
      {results.overrepresentedKCs.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold text-orange-700 mb-2">
            Overrepresented KCs ({results.overrepresentedKCs.length})
          </h4>
          <div className="space-y-1">
            {results.overrepresentedKCs.map((o) => (
              <div key={o.kcId} className="p-2 bg-orange-50 border border-orange-200 rounded text-xs">
                <span className="font-bold text-orange-700">{o.kcName}</span>
                <span className="ml-2 text-gray-600">
                  linked to {o.outcomeCount} outcomes, appears on {o.pageCount} page(s)
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Late-Introduced KCs */}
      {results.lateIntroducedKCs.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold text-purple-700 mb-2">
            Late-Introduced KCs ({results.lateIntroducedKCs.length})
          </h4>
          <div className="space-y-1">
            {results.lateIntroducedKCs.map((l) => (
              <div key={l.kcId} className="p-2 bg-purple-50 border border-purple-200 rounded text-xs">
                <span className="font-bold text-purple-700">{l.kcName}</span>
                <p className="mt-1 text-gray-600">{l.expectedEarlierBecause}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recommendations */}
      {results.recommendations.length > 0 && (
        <section>
          <h4 className="text-sm font-semibold text-gray-700 mb-2">
            Recommendations ({results.recommendations.length})
          </h4>
          <div className="space-y-1">
            {results.recommendations.map((r, i) => (
              <div key={i} className="p-2 bg-white border border-gray-200 rounded text-xs flex items-start gap-2">
                <span className={`shrink-0 px-1.5 py-0.5 rounded font-medium text-[10px] ${
                  r.priority === 'high' ? 'bg-red-100 text-red-700' :
                  r.priority === 'medium' ? 'bg-yellow-100 text-yellow-700' :
                  'bg-gray-100 text-gray-600'
                }`}>
                  {r.priority}
                </span>
                <span className="shrink-0 px-1.5 py-0.5 rounded bg-gray-100 text-gray-600 text-[10px] font-mono">
                  {r.type}
                </span>
                <span className="text-gray-700">{r.rationale}</span>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

// ─── Coverage Matrix Sub-component ──────────────────────

function MatrixView({
  results,
  outcomes,
}: {
  results: CoverageResults;
  outcomes: SyllabusOutcome[];
}) {
  // Build matrix: outcomes (rows) x unique KCs (columns)
  const kcSet = new Map<string, string>();
  for (const cell of results.coverageMatrix) {
    kcSet.set(cell.kcId, cell.kcName);
  }
  const kcList = Array.from(kcSet.entries()).map(([id, name]) => ({ id, name }));

  // Build lookup
  const cellLookup = new Map<string, CoverageCell>();
  for (const cell of results.coverageMatrix) {
    cellLookup.set(`${cell.outcomeId}:${cell.kcId}`, cell);
  }

  if (kcList.length === 0) {
    return (
      <div className="text-sm text-gray-400 py-8 text-center">
        No outcome–KC mappings found. The coverage matrix is empty.
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse">
        <thead>
          <tr>
            <th className="p-2 text-left bg-gray-50 border border-gray-200 font-medium text-gray-600 sticky left-0 z-10">
              Outcome
            </th>
            {kcList.map((kc) => (
              <th
                key={kc.id}
                className="p-2 bg-gray-50 border border-gray-200 font-medium text-gray-600 max-w-[120px] truncate"
                title={kc.name}
              >
                {kc.name.length > 15 ? kc.name.slice(0, 15) + '...' : kc.name}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {outcomes.map((o) => (
            <tr key={o.id}>
              <td
                className="p-2 border border-gray-200 font-mono text-gray-700 sticky left-0 bg-white z-10 max-w-[200px]"
                title={o.description}
              >
                <span className="font-bold text-teal-700">{o.code}</span>
                <span className="ml-1 text-gray-500 truncate block text-[10px]">
                  {o.description.slice(0, 50)}...
                </span>
              </td>
              {kcList.map((kc) => {
                const cell = cellLookup.get(`${o.id}:${kc.id}`);
                return (
                  <td
                    key={kc.id}
                    className="p-2 border border-gray-200 text-center"
                    style={{
                      backgroundColor: cell
                        ? confidenceColor(cell.confidence)
                        : '#f9fafb',
                    }}
                    title={
                      cell
                        ? `${Math.round(cell.confidence * 100)}% confidence${cell.strength ? ', content: ' + cell.strength : ''}`
                        : 'No mapping'
                    }
                  >
                    {cell ? (
                      <span className="font-medium">
                        {Math.round(cell.confidence * 100)}%
                      </span>
                    ) : (
                      <span className="text-gray-300">-</span>
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 flex gap-4 text-[10px] text-gray-500">
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: confidenceColor(0.9) }} /> High (90%+)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: confidenceColor(0.7) }} /> Medium (70-89%)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: confidenceColor(0.5) }} /> Weak (50-69%)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-3 rounded" style={{ backgroundColor: confidenceColor(0.35) }} /> Very Weak (&lt;50%)
        </span>
      </div>
    </div>
  );
}

// ─── Timeline Sub-component ─────────────────────────────

function TimelineView({
  results,
  outcomes,
}: {
  results: CoverageResults;
  outcomes: SyllabusOutcome[];
}) {
  const outcomeMap = new Map(outcomes.map((o) => [o.id, o]));
  const totalOutcomes = outcomes.length;

  // Cumulative coverage tracker
  let cumulativeCovered = 0;

  return (
    <div className="space-y-4">
      <p className="text-xs text-gray-500">
        How curriculum outcomes are covered across the course page sequence.
      </p>

      {/* Heatmap: pages vs cumulative coverage */}
      <div className="overflow-x-auto">
        <div className="flex gap-0.5 items-end" style={{ minHeight: 120 }}>
          {results.timeline.map((entry) => {
            cumulativeCovered += entry.newOutcomesCovered.length;
            const pct = totalOutcomes > 0 ? (cumulativeCovered / totalOutcomes) * 100 : 0;
            return (
              <div
                key={entry.pageId}
                className="flex flex-col items-center"
                style={{ minWidth: 28 }}
                title={`${entry.pageTitle}\n${entry.outcomeIds.length} outcome(s), ${entry.newOutcomesCovered.length} new`}
              >
                <div
                  className="w-5 rounded-t transition-all"
                  style={{
                    height: `${Math.max(4, pct)}px`,
                    backgroundColor:
                      entry.newOutcomesCovered.length > 0 ? '#14b8a6' : '#d1d5db',
                  }}
                />
                <span className="text-[8px] text-gray-400 mt-0.5 transform -rotate-45 origin-top-left whitespace-nowrap">
                  {entry.pageTitle.length > 8
                    ? entry.pageTitle.slice(0, 8) + '..'
                    : entry.pageTitle}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Detailed timeline */}
      <div className="space-y-1 max-h-96 overflow-y-auto">
        {results.timeline
          .filter((e) => e.outcomeIds.length > 0 || e.newOutcomesCovered.length > 0)
          .map((entry) => (
            <div key={entry.pageId} className="p-2 bg-white border border-gray-200 rounded text-xs">
              <div className="flex items-center gap-2">
                <span className="text-gray-400 font-mono">#{entry.globalOrder + 1}</span>
                <span className="font-medium text-gray-800">{entry.pageTitle}</span>
                <span className="text-gray-400">({entry.moduleTitle})</span>
              </div>
              {entry.newOutcomesCovered.length > 0 && (
                <div className="mt-1 flex flex-wrap gap-1">
                  {entry.newOutcomesCovered.map((oId) => {
                    const o = outcomeMap.get(oId);
                    return (
                      <span
                        key={oId}
                        className="px-1.5 py-0.5 rounded bg-teal-100 text-teal-700 text-[10px]"
                        title={o?.description}
                      >
                        {o?.code || oId} (new)
                      </span>
                    );
                  })}
                </div>
              )}
              {entry.outcomeIds.length > 0 && (
                <div className="mt-1 text-gray-500">
                  Covers: {entry.outcomeIds.map((id) => outcomeMap.get(id)?.code || id).join(', ')}
                  {' '}| KCs: {entry.kcIds.length}
                </div>
              )}
            </div>
          ))}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────

function SummaryCard({
  label,
  value,
  color,
}: {
  label: string;
  value: string | number;
  color: 'green' | 'red' | 'yellow' | 'blue' | 'gray';
}) {
  const colors = {
    green: 'bg-green-50 border-green-200 text-green-700',
    red: 'bg-red-50 border-red-200 text-red-700',
    yellow: 'bg-yellow-50 border-yellow-200 text-yellow-700',
    blue: 'bg-blue-50 border-blue-200 text-blue-700',
    gray: 'bg-gray-50 border-gray-200 text-gray-700',
  };
  return (
    <div className={`p-3 rounded-lg border ${colors[color]}`}>
      <div className="text-[10px] font-medium uppercase tracking-wide opacity-75">{label}</div>
      <div className="text-lg font-bold">{value}</div>
    </div>
  );
}

function confidenceColor(confidence: number): string {
  if (confidence >= 0.9) return '#bbf7d0'; // green-200
  if (confidence >= 0.7) return '#d9f99d'; // lime-200
  if (confidence >= 0.5) return '#fef08a'; // yellow-200
  return '#fecaca'; // red-200
}

function buildPdfHtml(results: CoverageResults, outcomes: SyllabusOutcome[]): string {
  const s = results.summary;
  const outcomeRows = outcomes
    .map((o) => {
      const maps = results.coverageMatrix.filter((c) => c.outcomeId === o.id);
      const status = maps.length === 0 ? 'UNMAPPED' : maps.some((m) => m.confidence >= 0.7) ? 'MAPPED' : 'WEAK';
      const kcs = maps.map((m) => `${m.kcName} (${Math.round(m.confidence * 100)}%)`).join(', ') || '-';
      return `<tr><td>${o.code}</td><td>${o.description}</td><td>${status}</td><td>${kcs}</td></tr>`;
    })
    .join('');

  const recRows = results.recommendations
    .map((r) => `<tr><td>${r.priority.toUpperCase()}</td><td>${r.type}</td><td>${r.rationale}</td></tr>`)
    .join('');

  return `<!DOCTYPE html><html><head><title>Curriculum Coverage Report</title>
<style>body{font-family:sans-serif;font-size:12px;margin:20px}h1{font-size:18px}h2{font-size:14px;margin-top:20px}
table{border-collapse:collapse;width:100%}th,td{border:1px solid #ddd;padding:4px 8px;text-align:left}
th{background:#f5f5f5}.summary{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}
.card{border:1px solid #ddd;border-radius:6px;padding:8px 12px;min-width:100px}
.card .label{font-size:10px;text-transform:uppercase;color:#666}
.card .value{font-size:18px;font-weight:bold}</style></head><body>
<h1>Curriculum Coverage Report</h1>
<p>Analyzed: ${results.metadata.analyzedAt} | Pages: ${results.metadata.totalPages} | Outcomes: ${s.totalOutcomes}</p>
<div class="summary">
<div class="card"><div class="label">Coverage</div><div class="value">${s.coveragePercent}%</div></div>
<div class="card"><div class="label">Mapped</div><div class="value">${s.mappedOutcomes}/${s.totalOutcomes}</div></div>
<div class="card"><div class="label">Unmapped</div><div class="value">${s.unmappedOutcomeCount}</div></div>
<div class="card"><div class="label">KCs Linked</div><div class="value">${s.kcsWithOutcomeLink}/${s.totalApprovedKCs}</div></div>
</div>
<h2>Outcome Coverage</h2>
<table><thead><tr><th>Code</th><th>Description</th><th>Status</th><th>KCs</th></tr></thead>
<tbody>${outcomeRows}</tbody></table>
<h2>Recommendations (${results.recommendations.length})</h2>
<table><thead><tr><th>Priority</th><th>Type</th><th>Rationale</th></tr></thead>
<tbody>${recRows}</tbody></table>
</body></html>`;
}
