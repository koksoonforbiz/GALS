import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { DEFAULT_CODEBOOK, type Dimension } from '@gals-studio/shared/browser';

const DIMS: Dimension[] = ['affect', 'behavior', 'ef_event', 'motivation'];

export function Codebook() {
  const [versions, setVersions] = useState<any[]>([]);
  const [selected, setSelected] = useState<string | null>(null);

  async function refresh() {
    const cb = await api.codebook();
    setVersions(cb.versions);
    setSelected((s) => s ?? cb.versions[0]?.id ?? null);
  }
  useEffect(() => {
    void refresh();
  }, []);

  const current = versions.find((v) => v.id === selected);
  const def = current?.definition ?? DEFAULT_CODEBOOK;

  async function lock() {
    if (!current) return;
    if (!window.confirm(`Lock ${current.name} v${current.version}? Locking is required before gold coding; editing a locked version forks a new one.`)) return;
    await api.saveCodebook({ id: current.id, lock: true });
    await refresh();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold">Codebook</h1>
        <select value={selected ?? ''} onChange={(e) => setSelected(e.target.value)} className="rounded border border-slate-300 px-2 py-1 text-sm">
          {versions.map((v) => (
            <option key={v.id} value={v.id}>{v.name} v{v.version} {v.locked ? '🔒' : ''}</option>
          ))}
        </select>
        {current && !current.locked && (
          <button onClick={lock} className="rounded bg-slate-900 px-3 py-1 text-sm text-white">Lock version</button>
        )}
        {current?.locked && <span className="text-sm text-amber-600">Locked — editing forks a new version</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {DIMS.map((dim) => (
          <section key={dim} className="rounded-lg border border-slate-200 bg-white p-3">
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-slate-500">
              {def.dimensions?.[dim]?.label ?? dim} · {def.dimensions?.[dim]?.cardinality}
            </h2>
            <div className="space-y-1">
              {(def.codes ?? []).filter((c: any) => c.dimension === dim).map((c: any) => (
                <div key={c.key} className="flex items-center gap-2 text-sm">
                  <kbd className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-xs">{c.shortcut}</kbd>
                  <span className="inline-block h-3 w-3 rounded" style={{ backgroundColor: c.color }} />
                  <span className="font-medium">{c.label}</span>
                  <span className="truncate text-xs text-slate-400" title={c.definition}>{c.definition}</span>
                </div>
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
