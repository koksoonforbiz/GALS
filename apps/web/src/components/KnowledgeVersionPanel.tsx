import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { InfoTooltip } from './InfoTooltip';
import { formatDateTimeSGT } from '../lib/formatDateTime';

// ─── Types ──────────────────────────────────────────────

interface VersionSummary {
  id: string;
  version: number;
  changeSummary: string;
  changeType: string;
  source: string;
  authorId: string | null;
  createdAt: string;
  stats: {
    kcCount: number;
    edgeCount: number;
    mappingCount: number;
  };
}

interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

interface KcDiffEntry {
  id: string;
  name?: string;
  description?: string | null;
  status?: string;
  changes?: FieldChange[];
}

interface EdgeDiffEntry {
  id: string;
  fromKcId?: string;
  toKcId?: string;
  relationship?: string;
  weight?: number;
  changes?: FieldChange[];
}

interface MappingDiffEntry {
  id: string;
  kcId?: string;
  pageId?: string;
  strength?: string;
  changes?: FieldChange[];
}

interface VersionDiff {
  kcs: {
    added: KcDiffEntry[];
    removed: KcDiffEntry[];
    modified: Array<{ id: string; name?: string; changes: FieldChange[] }>;
  };
  edges: {
    added: EdgeDiffEntry[];
    removed: EdgeDiffEntry[];
    modified: Array<{ id: string; changes: FieldChange[] }>;
  };
  mappings: {
    added: MappingDiffEntry[];
    removed: MappingDiffEntry[];
    modified: Array<{ id: string; changes: FieldChange[] }>;
  };
}

type View = 'list' | 'diff';

// ─── Component ──────────────────────────────────────────

export default function KnowledgeVersionPanel({ courseId }: { courseId: string }) {
  const [versions, setVersions] = useState<VersionSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<View>('list');
  const [selectedVersion, setSelectedVersion] = useState<VersionSummary | null>(null);
  const [diff, setDiff] = useState<VersionDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const base = `/courses/${courseId}/knowledge-versions`;

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<VersionSummary[]>(base);
      setVersions(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [base]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const viewDiff = async (version: VersionSummary) => {
    setSelectedVersion(version);
    setDiffLoading(true);
    setDiff(null);
    setView('diff');
    try {
      const data = await apiFetch<VersionDiff>(`${base}/${version.id}/diff`);
      setDiff(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load diff');
    } finally {
      setDiffLoading(false);
    }
  };

  const handleRestore = async (versionId: string) => {
    setRestoring(true);
    setError(null);
    try {
      const result = await apiFetch<{ restoredVersion: number; newVersionId: string }>(
        `${base}/${versionId}/restore`,
        { method: 'POST' },
      );
      setSuccessMsg(`Restored to version ${result.restoredVersion}. A new version was created.`);
      setConfirmRestore(null);
      setView('list');
      fetchVersions();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Restore failed');
    } finally {
      setRestoring(false);
    }
  };

  const handleExport = (versionId: string) => {
    const token = localStorage.getItem('token');
    window.open(`/api${base}/${versionId}/export?token=${token}`, '_blank');
  };

  // ─── Render ──────────────────────────────────────────

  return (
    <div className="max-w-5xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-semibold text-gray-900">Knowledge Version History</h3>
          <p className="text-sm text-gray-500">
            Track changes to KCs, graph edges, and content mappings. Restore any previous version
            safely.
          </p>
        </div>
        {view === 'diff' && (
          <button
            onClick={() => {
              setView('list');
              setDiff(null);
              setSelectedVersion(null);
            }}
            className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
          >
            Back to list
          </button>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded text-sm text-red-700">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {successMsg && (
        <div className="mb-4 p-3 bg-green-50 border border-green-200 rounded text-sm text-green-700">
          {successMsg}
          <button onClick={() => setSuccessMsg(null)} className="ml-2 underline">
            dismiss
          </button>
        </div>
      )}

      {/* ─── List View ─── */}
      {view === 'list' && (
        <div>
          {loading ? (
            <p className="text-sm text-gray-400">Loading versions...</p>
          ) : versions.length === 0 ? (
            <div className="text-center py-12 bg-gray-50 rounded-lg border-2 border-dashed border-gray-300">
              <p className="text-gray-500 mb-2">No version history yet</p>
              <p className="text-sm text-gray-400">
                Versions are created automatically when you modify KCs, graph edges, or content
                mappings.
              </p>
            </div>
          ) : (
            <div className="space-y-2">
              {versions.map((v) => (
                <div
                  key={v.id}
                  className="bg-white border border-gray-200 rounded-lg p-3 hover:border-indigo-300 transition-colors"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                      <span className="text-sm font-mono font-bold text-indigo-600">
                        v{v.version}
                      </span>
                      <ChangeTypeBadge type={v.changeType} />
                      <SourceBadge source={v.source} />
                      <span className="text-sm text-gray-700 truncate">{v.changeSummary}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0 ml-3">
                      <span className="text-[10px] text-gray-400">
                        {formatDateTimeSGT(v.createdAt)}
                      </span>
                      <button
                        onClick={() => viewDiff(v)}
                        className="text-xs px-2 py-1 bg-indigo-50 text-indigo-700 rounded hover:bg-indigo-100"
                      >
                        Diff
                        <span className="ml-1 inline-flex">
                          <InfoTooltip text="Show detailed changes between this version snapshot and the current state." />
                        </span>
                      </button>
                      <button
                        onClick={() => handleExport(v.id)}
                        className="text-xs px-2 py-1 bg-gray-50 text-gray-600 rounded hover:bg-gray-100"
                      >
                        Export
                        <span className="ml-1 inline-flex">
                          <InfoTooltip text="Download this version snapshot as a JSON file." />
                        </span>
                      </button>
                      {v.version < versions[0]!.version && (
                        <button
                          onClick={() => setConfirmRestore(v.id)}
                          className="text-xs px-2 py-1 bg-amber-50 text-amber-700 rounded hover:bg-amber-100"
                        >
                          Restore
                          <span className="ml-1 inline-flex">
                            <InfoTooltip
                              text="Restore course KCs, edges, and mappings to this version. Creates a new version from the restored state."
                              warn={true}
                            />
                          </span>
                        </button>
                      )}
                    </div>
                  </div>
                  <div className="mt-1 flex gap-3 text-[10px] text-gray-400">
                    <span>{v.stats.kcCount} KCs</span>
                    <span>{v.stats.edgeCount} edges</span>
                    <span>{v.stats.mappingCount} mappings</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ─── Diff View ─── */}
      {view === 'diff' && selectedVersion && (
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm">
            <span className="font-mono font-bold text-indigo-600">v{selectedVersion.version}</span>
            <span className="text-gray-500">→</span>
            <span className="font-medium text-gray-700">Current State</span>
            <span className="text-gray-400 ml-auto">
              {formatDateTimeSGT(selectedVersion.createdAt)}
            </span>
          </div>

          <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
            <strong>Impact warning:</strong> Restoring this version will replace all current KCs (
            {diff ? totalChanges(diff) : '...'} changes), graph edges, and content mappings with the
            snapshot from v{selectedVersion.version}. A new version will be created to preserve the
            current state.
          </div>

          {diffLoading ? (
            <p className="text-sm text-gray-400 animate-pulse">Computing diff...</p>
          ) : diff ? (
            <DiffDisplay diff={diff} />
          ) : null}

          <div className="flex gap-2">
            <button
              onClick={() => setConfirmRestore(selectedVersion.id)}
              disabled={restoring}
              className="text-xs px-3 py-1.5 bg-amber-600 text-white rounded hover:bg-amber-700 disabled:opacity-50"
            >
              {restoring ? 'Restoring...' : `Restore to v${selectedVersion.version}`}
            </button>
            <button
              onClick={() => handleExport(selectedVersion.id)}
              className="text-xs px-3 py-1.5 bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
            >
              Export Snapshot
              <span className="ml-1 inline-flex">
                <InfoTooltip text="Download the full version snapshot including KCs, edges, and mappings." />
              </span>
            </button>
          </div>
        </div>
      )}

      {/* ─── Confirm Restore Modal ─── */}
      {confirmRestore && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl p-6 max-w-md w-full mx-4">
            <h4 className="text-lg font-semibold text-gray-900 mb-2">Confirm Restore</h4>
            <p className="text-sm text-gray-600 mb-4">
              This will restore the knowledge structure (KCs, graph edges, and content mappings) to
              the selected version. The current state will be preserved as a new version.
            </p>
            <div className="p-3 bg-amber-50 border border-amber-200 rounded text-xs text-amber-800 mb-4">
              <strong>This action will:</strong>
              <ul className="mt-1 list-disc list-inside space-y-0.5">
                <li>Replace all current KCs with the snapshot</li>
                <li>Replace all graph edges with the snapshot</li>
                <li>Replace all content mappings with the snapshot</li>
                <li>Create a new version recording this restore</li>
              </ul>
            </div>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setConfirmRestore(null)}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={() => handleRestore(confirmRestore)}
                disabled={restoring}
                className="px-4 py-2 text-sm bg-amber-600 text-white rounded-lg hover:bg-amber-700 disabled:opacity-50"
              >
                {restoring ? 'Restoring...' : 'Restore Version'}
                <span className="ml-1 inline-flex">
                  <InfoTooltip
                    text="This replaces all current KCs, edges, and mappings with the snapshot data. A new version is created automatically."
                    warn={true}
                  />
                </span>
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Sub-components ─────────────────────────────────────

function ChangeTypeBadge({ type }: { type: string }) {
  const colors: Record<string, string> = {
    KC_APPROVE: 'bg-green-100 text-green-700',
    KC_EDIT: 'bg-blue-100 text-blue-700',
    KC_MERGE: 'bg-purple-100 text-purple-700',
    KC_ARCHIVE: 'bg-gray-100 text-gray-600',
    KC_DELETE: 'bg-red-100 text-red-700',
    EDGE_ADD: 'bg-teal-100 text-teal-700',
    EDGE_UPDATE: 'bg-teal-100 text-teal-700',
    EDGE_DELETE: 'bg-red-100 text-red-700',
    EDGE_GENERATE: 'bg-violet-100 text-violet-700',
    MAPPING_ADD: 'bg-cyan-100 text-cyan-700',
    MAPPING_UPDATE: 'bg-cyan-100 text-cyan-700',
    MAPPING_DELETE: 'bg-red-100 text-red-700',
    MAPPING_AUTO_GENERATE: 'bg-violet-100 text-violet-700',
    RESTORE: 'bg-amber-100 text-amber-700',
  };
  return (
    <span
      className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${colors[type] || 'bg-gray-100 text-gray-600'}`}
    >
      {type.replace(/_/g, ' ')}
    </span>
  );
}

function SourceBadge({ source }: { source: string }) {
  if (source === 'ai')
    return <span className="text-[10px] px-1 py-0.5 rounded bg-violet-50 text-violet-600">AI</span>;
  if (source === 'restore')
    return (
      <span className="text-[10px] px-1 py-0.5 rounded bg-amber-50 text-amber-600">Restore</span>
    );
  return null;
}

function DiffDisplay({ diff }: { diff: VersionDiff }) {
  const hasKcChanges =
    diff.kcs.added.length + diff.kcs.removed.length + diff.kcs.modified.length > 0;
  const hasEdgeChanges =
    diff.edges.added.length + diff.edges.removed.length + diff.edges.modified.length > 0;
  const hasMapChanges =
    diff.mappings.added.length + diff.mappings.removed.length + diff.mappings.modified.length > 0;

  if (!hasKcChanges && !hasEdgeChanges && !hasMapChanges) {
    return (
      <p className="text-sm text-gray-400">
        No differences — the current state matches this version.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      {/* KC Diff */}
      {hasKcChanges && (
        <DiffSection
          title="Knowledge Components"
          added={diff.kcs.added.map((kc) => kc.name || kc.id)}
          removed={diff.kcs.removed.map((kc) => kc.name || kc.id)}
          modified={diff.kcs.modified.map((kc) => ({
            label: kc.name || kc.id,
            changes: kc.changes,
          }))}
        />
      )}

      {/* Edge Diff */}
      {hasEdgeChanges && (
        <DiffSection
          title="Graph Edges"
          added={diff.edges.added.map(
            (e) => `${e.fromKcId?.slice(0, 8)} → ${e.toKcId?.slice(0, 8)} (${e.relationship})`,
          )}
          removed={diff.edges.removed.map(
            (e) => `${e.fromKcId?.slice(0, 8)} → ${e.toKcId?.slice(0, 8)} (${e.relationship})`,
          )}
          modified={diff.edges.modified.map((e) => ({
            label: e.id.slice(0, 8),
            changes: e.changes,
          }))}
        />
      )}

      {/* Mapping Diff */}
      {hasMapChanges && (
        <DiffSection
          title="Content Mappings"
          added={diff.mappings.added.map(
            (m) => `KC ${m.kcId?.slice(0, 8)} ↔ Page ${m.pageId?.slice(0, 8)} (${m.strength})`,
          )}
          removed={diff.mappings.removed.map(
            (m) => `KC ${m.kcId?.slice(0, 8)} ↔ Page ${m.pageId?.slice(0, 8)} (${m.strength})`,
          )}
          modified={diff.mappings.modified.map((m) => ({
            label: m.id.slice(0, 8),
            changes: m.changes,
          }))}
        />
      )}
    </div>
  );
}

function DiffSection({
  title,
  added,
  removed,
  modified,
}: {
  title: string;
  added: string[];
  removed: string[];
  modified: Array<{ label: string; changes: FieldChange[] }>;
}) {
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="bg-gray-50 px-3 py-2 text-xs font-semibold text-gray-700 flex items-center gap-2">
        {title}
        {added.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-green-100 text-green-700">+{added.length}</span>
        )}
        {removed.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-red-100 text-red-700">-{removed.length}</span>
        )}
        {modified.length > 0 && (
          <span className="px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
            ~{modified.length}
          </span>
        )}
      </div>
      <div className="divide-y divide-gray-100 max-h-48 overflow-y-auto">
        {added.map((item, i) => (
          <div key={`a-${i}`} className="px-3 py-1.5 text-xs flex items-center gap-2">
            <span className="text-green-600 font-bold">+</span>
            <span className="text-gray-700">{item}</span>
          </div>
        ))}
        {removed.map((item, i) => (
          <div key={`r-${i}`} className="px-3 py-1.5 text-xs flex items-center gap-2">
            <span className="text-red-600 font-bold">-</span>
            <span className="text-gray-500 line-through">{item}</span>
          </div>
        ))}
        {modified.map((item, i) => (
          <div key={`m-${i}`} className="px-3 py-1.5 text-xs">
            <div className="flex items-center gap-2">
              <span className="text-blue-600 font-bold">~</span>
              <span className="text-gray-700 font-medium">{item.label}</span>
            </div>
            <div className="ml-5 mt-0.5 space-y-0.5">
              {item.changes.map((c, j) => (
                <div key={j} className="text-gray-500">
                  <span className="font-mono">{c.field}:</span>{' '}
                  <span className="text-red-500 line-through">{String(c.from)}</span>
                  {' → '}
                  <span className="text-green-600">{String(c.to)}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────

function totalChanges(diff: VersionDiff): number {
  return (
    diff.kcs.added.length +
    diff.kcs.removed.length +
    diff.kcs.modified.length +
    diff.edges.added.length +
    diff.edges.removed.length +
    diff.edges.modified.length +
    diff.mappings.added.length +
    diff.mappings.removed.length +
    diff.mappings.modified.length
  );
}
