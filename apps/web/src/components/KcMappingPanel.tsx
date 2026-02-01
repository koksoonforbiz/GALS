import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../lib/api';
import { useToast } from './Toast';

// ─── Types ──────────────────────────────────────────────

interface KcMapping {
  id: string;
  courseId: string;
  kcId: string;
  pageId: string;
  strength: string;
  blockIds: string[];
  createdBy: string;
  kc?: { id: string; name: string; status: string };
}

interface MappingSummary {
  byKc: Record<string, { kcName: string; pages: Array<{ pageId: string; strength: string }> }>;
  byPage: Record<string, Array<{ kcId: string; kcName: string; strength: string }>>;
  totalMappings: number;
}

interface ProposedKC {
  id: string;
  name: string;
  status: string;
}

interface ModuleItem {
  id: string;
  title: string;
  moduleTitle: string;
}

interface Props {
  courseId: string;
}

// ─── Component ──────────────────────────────────────────

export default function KcMappingPanel({ courseId }: Props) {
  const { toast } = useToast();
  const [summary, setSummary] = useState<MappingSummary | null>(null);
  const [mappings, setMappings] = useState<KcMapping[]>([]);
  const [kcs, setKcs] = useState<ProposedKC[]>([]);
  const [pages, setPages] = useState<ModuleItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [viewMode, setViewMode] = useState<'by-kc' | 'by-page'>('by-kc');
  const [generating, setGenerating] = useState(false);

  // Add mapping form
  const [addKcId, setAddKcId] = useState('');
  const [addPageId, setAddPageId] = useState('');
  const [addStrength, setAddStrength] = useState('MEDIUM');
  const [showAddForm, setShowAddForm] = useState(false);

  const fetchData = useCallback(async () => {
    try {
      const [summaryData, mappingsData, kcsData] = await Promise.all([
        apiFetch<MappingSummary>(`/kc-mappings/summary?courseId=${courseId}`),
        apiFetch<KcMapping[]>(`/kc-mappings?courseId=${courseId}`),
        apiFetch<ProposedKC[]>(`/proposed-kcs?courseId=${courseId}`),
      ]);
      setSummary(summaryData);
      setMappings(mappingsData);
      setKcs(kcsData.filter((k) => k.status !== 'ARCHIVED'));

      // Fetch pages (modules with items)
      const course = await apiFetch<{ modules: Array<{ title: string; items: Array<{ id: string; title: string }> }> }>(
        `/courses/${courseId}`,
      );
      const allPages: ModuleItem[] = [];
      for (const mod of course.modules || []) {
        for (const item of mod.items || []) {
          allPages.push({ id: item.id, title: item.title, moduleTitle: mod.title });
        }
      }
      setPages(allPages);
    } catch (err: any) {
      toast('error', err.message || 'Failed to load mappings');
    }
  }, [courseId, toast]);

  useEffect(() => {
    setLoading(true);
    fetchData().finally(() => setLoading(false));
  }, [fetchData]);

  // ─── Actions ────────────────────────────────────────────

  const handleAutoGenerate = async () => {
    setGenerating(true);
    try {
      const result = await apiFetch<{ mappingsCreated: number }>('/kc-mappings/auto-generate', {
        method: 'POST',
        body: JSON.stringify({ courseId }),
      });
      toast('success', `Generated ${result.mappingsCreated} mappings from KC evidence`);
      await fetchData();
    } catch (err: any) {
      toast('error', err.message || 'Failed to auto-generate');
    } finally {
      setGenerating(false);
    }
  };

  const handleAddMapping = async () => {
    if (!addKcId || !addPageId) return;
    try {
      await apiFetch('/kc-mappings', {
        method: 'POST',
        body: JSON.stringify({
          courseId,
          kcId: addKcId,
          pageId: addPageId,
          strength: addStrength,
        }),
      });
      toast('success', 'Mapping added');
      setShowAddForm(false);
      setAddKcId('');
      setAddPageId('');
      await fetchData();
    } catch (err: any) {
      toast('error', err.message || 'Failed to add mapping');
    }
  };

  const handleUpdateStrength = async (mappingId: string, strength: string) => {
    try {
      await apiFetch(`/kc-mappings/${mappingId}`, {
        method: 'PATCH',
        body: JSON.stringify({ strength }),
      });
      await fetchData();
    } catch (err: any) {
      toast('error', err.message || 'Failed to update');
    }
  };

  const handleRemove = async (mappingId: string) => {
    try {
      await apiFetch(`/kc-mappings/${mappingId}`, { method: 'DELETE' });
      toast('success', 'Mapping removed');
      await fetchData();
    } catch (err: any) {
      toast('error', err.message || 'Failed to remove');
    }
  };

  // ─── Helpers ────────────────────────────────────────────

  const strengthBadge = (s: string) => {
    const colors: Record<string, string> = {
      HIGH: 'bg-green-100 text-green-700',
      MEDIUM: 'bg-yellow-100 text-yellow-700',
      LOW: 'bg-red-100 text-red-700',
    };
    return (
      <span className={`px-2 py-0.5 text-xs font-medium rounded-full ${colors[s] || 'bg-gray-100 text-gray-600'}`}>
        {s}
      </span>
    );
  };

  const pageName = (pageId: string) => {
    const page = pages.find((p) => p.id === pageId);
    return page ? `${page.moduleTitle} / ${page.title}` : pageId.slice(0, 8);
  };

  // ─── Render ─────────────────────────────────────────────

  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading KC Mappings...</div>;
  }

  return (
    <div className="space-y-4">
      {/* Toolbar */}
      <div className="flex items-center gap-3 flex-wrap">
        <button
          onClick={handleAutoGenerate}
          disabled={generating}
          className="px-4 py-2 text-sm bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
        >
          {generating ? 'Generating...' : 'Auto-Generate from Evidence'}
        </button>
        <button
          onClick={() => setShowAddForm(!showAddForm)}
          className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
        >
          {showAddForm ? 'Cancel' : 'Add Mapping'}
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={() => setViewMode('by-kc')}
            className={`px-3 py-1 text-xs rounded-l border ${viewMode === 'by-kc' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}
          >
            By KC
          </button>
          <button
            onClick={() => setViewMode('by-page')}
            className={`px-3 py-1 text-xs rounded-r border ${viewMode === 'by-page' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300'}`}
          >
            By Page
          </button>
        </div>
        <span className="text-xs text-gray-500">{summary?.totalMappings || 0} mappings</span>
      </div>

      {/* Add Form */}
      {showAddForm && (
        <div className="flex items-center gap-2 p-3 bg-gray-50 rounded-lg border">
          <select value={addKcId} onChange={(e) => setAddKcId(e.target.value)} className="border rounded px-2 py-1 text-sm flex-1">
            <option value="">Select KC...</option>
            {kcs.map((k) => <option key={k.id} value={k.id}>{k.name}</option>)}
          </select>
          <span className="text-gray-400">↔</span>
          <select value={addPageId} onChange={(e) => setAddPageId(e.target.value)} className="border rounded px-2 py-1 text-sm flex-1">
            <option value="">Select Page...</option>
            {pages.map((p) => <option key={p.id} value={p.id}>{p.moduleTitle} / {p.title}</option>)}
          </select>
          <select value={addStrength} onChange={(e) => setAddStrength(e.target.value)} className="border rounded px-2 py-1 text-sm w-24">
            <option value="HIGH">HIGH</option>
            <option value="MEDIUM">MEDIUM</option>
            <option value="LOW">LOW</option>
          </select>
          <button
            onClick={handleAddMapping}
            disabled={!addKcId || !addPageId}
            className="px-3 py-1 text-sm bg-indigo-600 text-white rounded hover:bg-indigo-700 disabled:opacity-50"
          >
            Add
          </button>
        </div>
      )}

      {/* By KC View */}
      {viewMode === 'by-kc' && summary && (
        <div className="space-y-3">
          {Object.entries(summary.byKc).length === 0 ? (
            <div className="text-center py-8 text-gray-400">No KC mappings yet. Click "Auto-Generate from Evidence" to start.</div>
          ) : (
            Object.entries(summary.byKc).map(([kcId, data]) => (
              <div key={kcId} className="border rounded-lg p-3">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">{data.kcName}</h4>
                <div className="space-y-1">
                  {data.pages.map((p) => {
                    const mapping = mappings.find((m) => m.kcId === kcId && m.pageId === p.pageId);
                    return (
                      <div key={p.pageId} className="flex items-center gap-2 text-xs">
                        <span className="text-gray-600 flex-1">{pageName(p.pageId)}</span>
                        <div className="flex items-center gap-1">
                          {['LOW', 'MEDIUM', 'HIGH'].map((s) => (
                            <button
                              key={s}
                              onClick={() => mapping && handleUpdateStrength(mapping.id, s)}
                              className={`px-1.5 py-0.5 rounded text-[10px] ${
                                p.strength === s
                                  ? s === 'HIGH' ? 'bg-green-600 text-white' : s === 'MEDIUM' ? 'bg-yellow-500 text-white' : 'bg-red-500 text-white'
                                  : 'bg-gray-100 text-gray-400 hover:bg-gray-200'
                              }`}
                            >
                              {s}
                            </button>
                          ))}
                        </div>
                        {mapping && (
                          <button
                            onClick={() => handleRemove(mapping.id)}
                            className="text-red-400 hover:text-red-600"
                            title="Remove"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* By Page View */}
      {viewMode === 'by-page' && summary && (
        <div className="space-y-3">
          {Object.entries(summary.byPage).length === 0 ? (
            <div className="text-center py-8 text-gray-400">No page mappings yet.</div>
          ) : (
            Object.entries(summary.byPage).map(([pageId, kcList]) => (
              <div key={pageId} className="border rounded-lg p-3">
                <h4 className="text-sm font-semibold text-gray-800 mb-2">{pageName(pageId)}</h4>
                <div className="flex flex-wrap gap-2">
                  {kcList.map((kc) => {
                    const mapping = mappings.find((m) => m.kcId === kc.kcId && m.pageId === pageId);
                    return (
                      <div key={kc.kcId} className="flex items-center gap-1 bg-gray-50 rounded px-2 py-1">
                        <span className="text-xs text-gray-700">{kc.kcName}</span>
                        {strengthBadge(kc.strength)}
                        {mapping && (
                          <button
                            onClick={() => handleRemove(mapping.id)}
                            className="text-red-400 hover:text-red-600 ml-1 text-xs"
                            title="Remove"
                          >
                            ×
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}
