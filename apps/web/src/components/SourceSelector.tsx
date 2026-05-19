import { useState, useEffect } from 'react';
import { apiFetch } from '../lib/api';

interface SourceDocument {
  id: string;
  title: string;
  filename: string;
  chunkCount: number | null;
  indexedAt: string | null;
}

interface Props {
  courseId: string;
  selectedSourceIds: Set<string>;
  onSelectionChange: (ids: Set<string>) => void;
  compact?: boolean;
}

export default function SourceSelector({
  courseId,
  selectedSourceIds,
  onSelectionChange,
  compact = false,
}: Props) {
  const [sources, setSources] = useState<SourceDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(!compact);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const docs = await apiFetch<SourceDocument[]>(`/courses/${courseId}/documents`);
        if (!cancelled) {
          setSources(docs);
          // Auto-select all indexed sources if nothing selected yet
          if (selectedSourceIds.size === 0) {
            const indexed = docs.filter((d) => d.indexedAt && (d.chunkCount ?? 0) > 0);
            onSelectionChange(new Set(indexed.map((d) => d.id)));
          }
        }
      } catch {
        // silently fail
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const indexed = sources.filter((d) => d.indexedAt && (d.chunkCount ?? 0) > 0);

  const toggle = (id: string) => {
    const next = new Set(selectedSourceIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    onSelectionChange(next);
  };

  const selectAll = () => onSelectionChange(new Set(indexed.map((d) => d.id)));
  const clearAll = () => onSelectionChange(new Set());

  if (loading) return <span className="text-xs text-gray-400">Loading sources...</span>;
  if (indexed.length === 0) {
    return (
      <span className="text-xs text-yellow-600">No indexed sources available.</span>
    );
  }

  // Compact: show chips
  if (compact && !expanded) {
    return (
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-xs text-gray-500">{selectedSourceIds.size} source(s)</span>
        {Array.from(selectedSourceIds).slice(0, 3).map((id) => {
          const doc = indexed.find((d) => d.id === id);
          return doc ? (
            <span key={id} className="inline-flex items-center px-1.5 py-0.5 bg-indigo-50 text-indigo-700 rounded text-[10px]">
              {doc.title || doc.filename}
            </span>
          ) : null;
        })}
        {selectedSourceIds.size > 3 && (
          <span className="text-[10px] text-gray-400">+{selectedSourceIds.size - 3} more</span>
        )}
        <button
          onClick={() => setExpanded(true)}
          className="text-xs text-indigo-600 hover:text-indigo-800 underline"
        >
          Change
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-600">
          Sources ({selectedSourceIds.size}/{indexed.length})
        </span>
        <div className="flex gap-2 text-xs">
          <button onClick={selectAll} className="text-indigo-600 hover:text-indigo-800 underline">
            All
          </button>
          <button onClick={clearAll} className="text-gray-500 hover:text-gray-700 underline">
            None
          </button>
          {compact && (
            <button onClick={() => setExpanded(false)} className="text-gray-400 hover:text-gray-600">
              Collapse
            </button>
          )}
        </div>
      </div>
      <div className="space-y-1 max-h-48 overflow-y-auto">
        {indexed.map((doc) => (
          <label
            key={doc.id}
            className={`flex items-center gap-2 px-2 py-1.5 rounded border cursor-pointer text-xs transition-colors ${
              selectedSourceIds.has(doc.id)
                ? 'border-indigo-300 bg-indigo-50'
                : 'border-gray-200 hover:border-gray-300'
            }`}
          >
            <input
              type="checkbox"
              checked={selectedSourceIds.has(doc.id)}
              onChange={() => toggle(doc.id)}
              className="rounded border-gray-300 text-indigo-600 w-3.5 h-3.5"
            />
            <span className="truncate flex-1">{doc.title || doc.filename}</span>
            <span className="text-gray-400 shrink-0">{doc.chunkCount}ch</span>
          </label>
        ))}
      </div>
    </div>
  );
}
