import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';

// ─── Types ──────────────────────────────────────────────

interface ProposedKC {
  id: string;
  courseId: string;
  name: string;
  description: string | null;
  status: 'PROPOSED' | 'APPROVED' | 'ARCHIVED';
  confidenceLevel: string;
  createdBy: string;
  generationJobId: string | null;
  relatedToKCId: string | null;
  evidence: any;
  pageIds: string[];
  createdAt: string;
  updatedAt: string;
  relatedTo?: { id: string; name: string } | null;
}

interface KcStats {
  proposed: number;
  approved: number;
  archived: number;
  total: number;
}

interface SimilarityPair {
  kcA: { id: string; name: string };
  kcB: { id: string; name: string };
  similarity: number;
}

interface KcHealth {
  id: string;
  name: string;
  status: string;
  pageCount: number;
  hasDescription: boolean;
  confidenceLevel: string;
  duplicateCount: number;
  coverageStatus: 'uncovered' | 'low' | 'moderate' | 'high';
  similarKcs: Array<{ id: string; name: string; similarity: number }>;
}

interface Props {
  courseId: string;
}

// ─── Component ──────────────────────────────────────────

export default function KcStudioPanel({ courseId }: Props) {
  const { toast } = useToast();
  const [kcs, setKcs] = useState<ProposedKC[]>([]);
  const [stats, setStats] = useState<KcStats | null>(null);
  const [loading, setLoading] = useState(true);
  const [filterStatus, setFilterStatus] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editDesc, setEditDesc] = useState('');
  const [mergeSourceId, setMergeSourceId] = useState<string | null>(null);
  const [mergeTargetId, setMergeTargetId] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [similarPairs, setSimilarPairs] = useState<SimilarityPair[]>([]);
  const [healthData, setHealthData] = useState<KcHealth[]>([]);
  const [showHealth, setShowHealth] = useState(false);

  const fetchKcs = useCallback(async () => {
    try {
      const params = new URLSearchParams({ courseId });
      if (filterStatus) params.set('status', filterStatus);
      const data = await apiFetch<ProposedKC[]>(`/proposed-kcs?${params}`);
      setKcs(data);
    } catch (err: any) {
      toast('error', err.message || 'Failed to load KCs');
    }
  }, [courseId, filterStatus, toast]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await apiFetch<KcStats>(`/proposed-kcs/stats?courseId=${courseId}`);
      setStats(data);
    } catch {
      // stats are non-critical
    }
  }, [courseId]);

  const fetchHealth = useCallback(async () => {
    try {
      const [pairs, health] = await Promise.all([
        apiFetch<SimilarityPair[]>(`/proposed-kcs/similar-pairs?courseId=${courseId}`),
        apiFetch<KcHealth[]>(`/proposed-kcs/health?courseId=${courseId}`),
      ]);
      setSimilarPairs(pairs);
      setHealthData(health);
    } catch {
      // non-critical
    }
  }, [courseId]);

  useEffect(() => {
    setLoading(true);
    Promise.all([fetchKcs(), fetchStats(), fetchHealth()]).finally(() => setLoading(false));
  }, [fetchKcs, fetchStats, fetchHealth]);

  // ─── Actions ────────────────────────────────────────────

  const handleApprove = async (id: string) => {
    setActionLoading(id);
    try {
      await apiFetch(`/proposed-kcs/${id}/approve`, { method: 'POST' });
      toast('success', 'KC approved');
      await Promise.all([fetchKcs(), fetchStats()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to approve');
    } finally {
      setActionLoading(null);
    }
  };

  const handleArchive = async (id: string) => {
    setActionLoading(id);
    try {
      await apiFetch(`/proposed-kcs/${id}/archive`, { method: 'POST' });
      toast('success', 'KC archived');
      await Promise.all([fetchKcs(), fetchStats()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to archive');
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Permanently delete this KC?')) return;
    setActionLoading(id);
    try {
      await apiFetch(`/proposed-kcs/${id}`, { method: 'DELETE' });
      toast('success', 'KC deleted');
      await Promise.all([fetchKcs(), fetchStats()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to delete');
    } finally {
      setActionLoading(null);
    }
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    setActionLoading(editingId);
    try {
      await apiFetch(`/proposed-kcs/${editingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: editName, description: editDesc }),
      });
      toast('success', 'KC updated');
      setEditingId(null);
      await fetchKcs();
    } catch (err: any) {
      toast('error', err.message || 'Failed to update');
    } finally {
      setActionLoading(null);
    }
  };

  const handleMerge = async () => {
    if (!mergeSourceId || !mergeTargetId) return;
    setActionLoading(mergeSourceId);
    try {
      await apiFetch('/proposed-kcs/merge', {
        method: 'POST',
        body: JSON.stringify({ targetId: mergeTargetId, sourceId: mergeSourceId }),
      });
      toast('success', 'KCs merged');
      setMergeSourceId(null);
      setMergeTargetId('');
      await Promise.all([fetchKcs(), fetchStats()]);
    } catch (err: any) {
      toast('error', err.message || 'Failed to merge');
    } finally {
      setActionLoading(null);
    }
  };

  const startEdit = (kc: ProposedKC) => {
    setEditingId(kc.id);
    setEditName(kc.name);
    setEditDesc(kc.description || '');
  };

  // ─── Helpers ────────────────────────────────────────────

  const statusBadge = (status: string) => {
    const colors: Record<string, string> = {
      PROPOSED: 'bg-yellow-100 text-yellow-800',
      APPROVED: 'bg-green-100 text-green-800',
      ARCHIVED: 'bg-gray-100 text-gray-500',
    };
    return (
      <span className={`inline-block px-2 py-0.5 text-xs font-medium rounded-full ${colors[status] || 'bg-gray-100 text-gray-600'}`}>
        {status}
      </span>
    );
  };

  const confidenceBadge = (level: string) => {
    const colors: Record<string, string> = {
      HIGH: 'text-green-700',
      MEDIUM: 'text-yellow-700',
      LOW: 'text-red-700',
    };
    return <span className={`text-xs font-medium ${colors[level] || 'text-gray-500'}`}>{level}</span>;
  };

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading Knowledge Components...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Stats Bar */}
      {stats && (
        <div className="grid grid-cols-4 gap-4">
          {[
            { label: 'Total', value: stats.total, color: 'bg-blue-50 text-blue-700' },
            { label: 'Proposed', value: stats.proposed, color: 'bg-yellow-50 text-yellow-700' },
            { label: 'Approved', value: stats.approved, color: 'bg-green-50 text-green-700' },
            { label: 'Archived', value: stats.archived, color: 'bg-gray-50 text-gray-500' },
          ].map((s) => (
            <div key={s.label} className={`rounded-lg p-3 text-center ${s.color}`}>
              <div className="text-2xl font-bold">{s.value}</div>
              <div className="text-xs">{s.label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filter */}
      <div className="flex items-center gap-3">
        <label className="text-sm font-medium text-gray-700">Filter:</label>
        {['', 'PROPOSED', 'APPROVED', 'ARCHIVED'].map((s) => (
          <button
            key={s}
            onClick={() => setFilterStatus(s)}
            className={`px-3 py-1 text-xs rounded-full border transition-colors ${
              filterStatus === s
                ? 'bg-blue-600 text-white border-blue-600'
                : 'bg-white text-gray-600 border-gray-300 hover:bg-gray-50'
            }`}
          >
            {s || 'All'}
          </button>
        ))}
      </div>

      {/* Health & Similarity Panel */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => setShowHealth(!showHealth)}
          className="px-3 py-1.5 text-xs bg-indigo-50 text-indigo-700 rounded border border-indigo-200 hover:bg-indigo-100"
        >
          {showHealth ? 'Hide' : 'Show'} Health Indicators
          {similarPairs.length > 0 && (
            <span className="ml-1 inline-block bg-orange-500 text-white rounded-full px-1.5 text-xs">
              {similarPairs.length} similar pairs
            </span>
          )}
        </button>
      </div>

      {showHealth && (
        <div className="space-y-4">
          {/* Similar Pairs Warning */}
          {similarPairs.length > 0 && (
            <div className="border border-orange-200 bg-orange-50 rounded-lg p-4">
              <h4 className="text-sm font-semibold text-orange-800 mb-2">
                Potential Duplicates ({similarPairs.length} pairs)
              </h4>
              <div className="space-y-2">
                {similarPairs.map((pair, i) => (
                  <div key={i} className="flex items-center gap-2 text-xs">
                    <span className="font-medium text-gray-900">{pair.kcA.name}</span>
                    <span className="text-orange-600">~ {Math.round(pair.similarity * 100)}%</span>
                    <span className="font-medium text-gray-900">{pair.kcB.name}</span>
                    <button
                      onClick={() => {
                        setMergeSourceId(pair.kcB.id);
                        setMergeTargetId(pair.kcA.id);
                      }}
                      className="ml-auto px-2 py-0.5 bg-purple-100 text-purple-700 rounded hover:bg-purple-200"
                    >
                      Merge
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Coverage Health */}
          {healthData.length > 0 && (
            <div className="border rounded-lg p-4">
              <h4 className="text-sm font-semibold text-gray-700 mb-2">Coverage Health</h4>
              <div className="grid grid-cols-4 gap-2 text-center text-xs">
                {[
                  { label: 'Uncovered', count: healthData.filter((h) => h.coverageStatus === 'uncovered').length, color: 'text-red-600' },
                  { label: 'Low', count: healthData.filter((h) => h.coverageStatus === 'low').length, color: 'text-orange-600' },
                  { label: 'Moderate', count: healthData.filter((h) => h.coverageStatus === 'moderate').length, color: 'text-yellow-600' },
                  { label: 'High', count: healthData.filter((h) => h.coverageStatus === 'high').length, color: 'text-green-600' },
                ].map((c) => (
                  <div key={c.label}>
                    <div className={`text-lg font-bold ${c.color}`}>{c.count}</div>
                    <div className="text-gray-500">{c.label}</div>
                  </div>
                ))}
              </div>
              {healthData.filter((h) => !h.hasDescription).length > 0 && (
                <p className="mt-2 text-xs text-gray-500">
                  {healthData.filter((h) => !h.hasDescription).length} KCs missing descriptions
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* KC Table */}
      {kcs.length === 0 ? (
        <div className="text-center py-12 text-gray-400">
          No Knowledge Components found. Generate lesson content to auto-propose KCs.
        </div>
      ) : (
        <div className="border rounded-lg overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-gray-50 border-b">
              <tr>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Name</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Status</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Confidence</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Pages</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Source</th>
                <th className="text-left px-4 py-2 font-medium text-gray-700">Related</th>
                <th className="text-right px-4 py-2 font-medium text-gray-700">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {kcs.map((kc) => (
                <tr key={kc.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3">
                    {editingId === kc.id ? (
                      <div className="space-y-1">
                        <input
                          type="text"
                          value={editName}
                          onChange={(e) => setEditName(e.target.value)}
                          className="w-full border rounded px-2 py-1 text-sm"
                        />
                        <textarea
                          value={editDesc}
                          onChange={(e) => setEditDesc(e.target.value)}
                          className="w-full border rounded px-2 py-1 text-xs"
                          rows={2}
                          placeholder="Description..."
                        />
                        <div className="flex gap-1">
                          <button
                            onClick={handleSaveEdit}
                            disabled={actionLoading === kc.id}
                            className="px-2 py-0.5 text-xs bg-blue-600 text-white rounded hover:bg-blue-700"
                          >
                            Save
                          </button>
                          <button
                            onClick={() => setEditingId(null)}
                            className="px-2 py-0.5 text-xs bg-gray-200 text-gray-700 rounded hover:bg-gray-300"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div>
                        <div className="font-medium text-gray-900">{kc.name}</div>
                        {kc.description && (
                          <div className="text-xs text-gray-500 mt-0.5">{kc.description}</div>
                        )}
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3">{statusBadge(kc.status)}</td>
                  <td className="px-4 py-3">{confidenceBadge(kc.confidenceLevel)}</td>
                  <td className="px-4 py-3">
                    {(() => {
                      const count = kc.pageIds.length;
                      const color = count === 0 ? 'text-red-600' : count === 1 ? 'text-orange-600' : count <= 3 ? 'text-yellow-600' : 'text-green-600';
                      return <span className={`text-xs font-medium ${color}`}>{count}</span>;
                    })()}
                  </td>
                  <td className="px-4 py-3">
                    <span className="text-xs text-gray-500">{kc.createdBy}</span>
                  </td>
                  <td className="px-4 py-3">
                    {kc.relatedTo ? (
                      <span className="text-xs text-orange-600" title={`Similar to: ${kc.relatedTo.name}`}>
                        ~ {kc.relatedTo.name.length > 30 ? kc.relatedTo.name.slice(0, 30) + '...' : kc.relatedTo.name}
                      </span>
                    ) : (
                      <span className="text-xs text-gray-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-1">
                      {kc.status === 'PROPOSED' && (
                        <>
                          <button
                            onClick={() => handleApprove(kc.id)}
                            disabled={actionLoading === kc.id}
                            className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                            title="Approve"
                          >
                            Approve
                          </button>
                          <button
                            onClick={() => handleArchive(kc.id)}
                            disabled={actionLoading === kc.id}
                            className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                            title="Archive"
                          >
                            Archive
                          </button>
                        </>
                      )}
                      {kc.status === 'APPROVED' && (
                        <button
                          onClick={() => handleArchive(kc.id)}
                          disabled={actionLoading === kc.id}
                          className="px-2 py-1 text-xs bg-gray-100 text-gray-600 rounded hover:bg-gray-200"
                          title="Archive"
                        >
                          Archive
                        </button>
                      )}
                      {kc.status === 'ARCHIVED' && (
                        <button
                          onClick={() => handleApprove(kc.id)}
                          disabled={actionLoading === kc.id}
                          className="px-2 py-1 text-xs bg-green-100 text-green-700 rounded hover:bg-green-200"
                          title="Restore"
                        >
                          Restore
                        </button>
                      )}
                      <button
                        onClick={() => startEdit(kc)}
                        disabled={actionLoading === kc.id}
                        className="px-2 py-1 text-xs bg-blue-50 text-blue-700 rounded hover:bg-blue-100"
                        title="Edit"
                      >
                        Edit
                      </button>
                      <button
                        onClick={() => {
                          setMergeSourceId(kc.id);
                          setMergeTargetId('');
                        }}
                        disabled={actionLoading === kc.id}
                        className="px-2 py-1 text-xs bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                        title="Merge into another KC"
                      >
                        Merge
                      </button>
                      <button
                        onClick={() => handleDelete(kc.id)}
                        disabled={actionLoading === kc.id}
                        className="px-2 py-1 text-xs bg-red-50 text-red-600 rounded hover:bg-red-100"
                        title="Delete permanently"
                      >
                        Del
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Merge Modal */}
      {mergeSourceId && (
        <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
            <h3 className="text-lg font-semibold mb-3">Merge Knowledge Component</h3>
            <p className="text-sm text-gray-600 mb-4">
              Merge <strong>{kcs.find((k) => k.id === mergeSourceId)?.name}</strong> into another KC.
              The source will be archived and its evidence will be combined with the target.
            </p>
            <select
              value={mergeTargetId}
              onChange={(e) => setMergeTargetId(e.target.value)}
              className="w-full border rounded px-3 py-2 text-sm mb-4"
            >
              <option value="">Select target KC...</option>
              {kcs
                .filter((k) => k.id !== mergeSourceId && k.status !== 'ARCHIVED')
                .map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.name} ({k.status})
                  </option>
                ))}
            </select>
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setMergeSourceId(null)}
                className="px-4 py-2 text-sm bg-gray-100 text-gray-700 rounded hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                onClick={handleMerge}
                disabled={!mergeTargetId || actionLoading === mergeSourceId}
                className="px-4 py-2 text-sm bg-purple-600 text-white rounded hover:bg-purple-700 disabled:opacity-50"
              >
                Merge
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
