import { useState, useEffect, useCallback } from 'react';
import { X, ExternalLink, Inbox, Loader2 } from 'lucide-react';
import { api } from '../../../lib/api';

interface TraceDrawerProps {
  sessionId: string;
  constructKey: string;
  displayName: string;
  onClose: () => void;
}

interface Detection {
  id: string;
  messageId: string;
  messageContent: string;
  constructKey: string;
  label: string;
  confidence: number | null;
  rationale: string | null;
  createdAt: string;
  model: string;
  promptVersion: number;
}

export function TraceDrawer({ sessionId, constructKey, displayName, onClose }: TraceDrawerProps) {
  const [items, setItems] = useState<Detection[]>([]);
  const [loading, setLoading] = useState(true);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [labelFilter, setLabelFilter] = useState('');

  const fetchDetections = useCallback(
    (cursor?: string) => {
      setLoading(true);
      const params = new URLSearchParams();
      params.set('constructKey', constructKey);
      if (labelFilter) params.set('label', labelFilter);
      if (cursor) params.set('cursor', cursor);
      params.set('limit', '50');

      api
        .get<{ items: Detection[]; nextCursor: string | null }>(
          `/text-mining/sessions/${sessionId}/detections?${params}`,
        )
        .then((res) => {
          if (cursor) {
            setItems((prev) => [...prev, ...res.items]);
          } else {
            setItems(res.items);
          }
          setNextCursor(res.nextCursor);
        })
        .catch(() => {})
        .finally(() => setLoading(false));
    },
    [sessionId, constructKey, labelFilter],
  );

  useEffect(() => {
    fetchDetections();
  }, [fetchDetections]);

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
        <h3 className="font-semibold text-gray-800">{displayName}</h3>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600"
          aria-label="Close drawer"
        >
          <X size={20} />
        </button>
      </div>

      {/* Filter bar */}
      <div className="px-4 py-2 border-b border-gray-100 flex items-center gap-2">
        <select
          value={labelFilter}
          onChange={(e) => setLabelFilter(e.target.value)}
          className="text-sm border border-gray-300 rounded px-2 py-1"
        >
          <option value="">All labels</option>
          <option value="positive">Positive</option>
          <option value="negative">Negative</option>
          <option value="on-task">On-task</option>
          <option value="off-task">Off-task</option>
          <option value="low">Low</option>
          <option value="medium">Medium</option>
          <option value="high">High</option>
          <option value="error">Error</option>
        </select>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto">
        {items.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center py-12 text-gray-400">
            <Inbox size={24} aria-hidden="true" />
            <p className="text-sm mt-2">No detections match these filters.</p>
          </div>
        )}

        {items.map((d) => (
          <div key={d.id} className="px-4 py-3 border-b border-gray-100 hover:bg-gray-50">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs text-gray-400" title={d.createdAt}>
                {new Date(d.createdAt).toLocaleString()}
              </span>
              <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 text-gray-600">
                {d.label}
              </span>
            </div>

            {d.confidence !== null && (
              <div className="flex items-center gap-2 mb-1">
                <div className="flex-1 bg-gray-200 rounded-full h-1.5">
                  <div
                    className="bg-blue-500 rounded-full h-1.5"
                    style={{ width: `${d.confidence * 100}%` }}
                  />
                </div>
                <span className="text-xs text-gray-500">{(d.confidence * 100).toFixed(0)}%</span>
              </div>
            )}

            {d.rationale && <p className="text-xs text-gray-600 mb-1">{d.rationale}</p>}

            <div className="flex items-center justify-between">
              <p className="text-xs text-gray-400 truncate flex-1 mr-2">
                &ldquo;{d.messageContent}&rdquo;
              </p>
              <a
                href={`/student/courses/dialogue?focusMessageId=${d.messageId}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-500 hover:text-blue-700 flex-shrink-0"
                title="View in dialogue"
              >
                <ExternalLink size={12} aria-hidden="true" />
              </a>
            </div>

            <span className="text-xs text-gray-300 mt-1 block">
              v{d.promptVersion} / {d.model}
            </span>
          </div>
        ))}

        {loading && (
          <div className="flex justify-center py-4">
            <Loader2 size={20} className="animate-spin text-blue-500" aria-hidden="true" />
          </div>
        )}

        {nextCursor && !loading && (
          <div className="flex justify-center py-3">
            <button
              onClick={() => fetchDetections(nextCursor)}
              className="text-sm text-blue-600 hover:text-blue-800"
            >
              Load more
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
