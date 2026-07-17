import { useState, useEffect, useCallback } from 'react';
import { apiFetch } from '../../lib/api';
import BlockRenderer from './BlockRenderer';
import { formatDateTimeSGT } from '../../lib/formatDateTime';

interface Version {
  id: string;
  version: number;
  source: string;
  authorId: string | null;
  jobId: string | null;
  createdAt: string;
}

interface VersionDetail extends Version {
  contentJson: string;
}

interface Props {
  itemId: string;
  onClose: () => void;
  onRollback: (content: string) => void;
}

export default function VersionHistoryPanel({ itemId, onClose, onRollback }: Props) {
  const [versions, setVersions] = useState<Version[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedVersion, setSelectedVersion] = useState<VersionDetail | null>(null);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [rolling, setRolling] = useState(false);

  const fetchVersions = useCallback(async () => {
    setLoading(true);
    try {
      const data = await apiFetch<Version[]>(`/items/${itemId}/versions`);
      setVersions(data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }, [itemId]);

  useEffect(() => {
    fetchVersions();
  }, [fetchVersions]);

  const handleSelect = async (ver: Version) => {
    setLoadingDetail(true);
    try {
      const detail = await apiFetch<VersionDetail>(`/items/${itemId}/versions/${ver.id}`);
      setSelectedVersion(detail);
    } catch {
      // silent
    } finally {
      setLoadingDetail(false);
    }
  };

  const handleRollback = async () => {
    if (!selectedVersion) return;
    setRolling(true);
    try {
      await apiFetch(`/items/${itemId}/versions/${selectedVersion.id}/rollback`, {
        method: 'POST',
      });
      onRollback(selectedVersion.contentJson);
      onClose();
    } catch {
      // silent
    } finally {
      setRolling(false);
    }
  };

  const sourceLabel = (source: string) => {
    switch (source) {
      case 'ai':
        return 'AI Generated';
      case 'rollback':
        return 'Rollback';
      default:
        return 'Manual Edit';
    }
  };

  const sourceBadge = (source: string) => {
    switch (source) {
      case 'ai':
        return 'bg-violet-100 text-violet-700';
      case 'rollback':
        return 'bg-amber-100 text-amber-700';
      default:
        return 'bg-gray-100 text-gray-600';
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/30" onClick={onClose} />

      {/* Panel */}
      <div className="relative ml-auto w-full max-w-3xl bg-white shadow-xl flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200">
          <h3 className="text-sm font-semibold text-gray-900">Version History</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-lg">
            &times;
          </button>
        </div>

        <div className="flex flex-1 overflow-hidden">
          {/* Version list */}
          <div className="w-64 border-r border-gray-200 overflow-y-auto">
            {loading ? (
              <p className="p-4 text-sm text-gray-400">Loading...</p>
            ) : versions.length === 0 ? (
              <p className="p-4 text-sm text-gray-400">No versions yet</p>
            ) : (
              versions.map((ver) => (
                <button
                  key={ver.id}
                  onClick={() => handleSelect(ver)}
                  className={`w-full text-left px-4 py-3 border-b border-gray-100 hover:bg-gray-50 transition-colors ${
                    selectedVersion?.id === ver.id ? 'bg-indigo-50' : ''
                  }`}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-gray-700">v{ver.version}</span>
                    <span
                      className={`text-[10px] px-1.5 py-0.5 rounded ${sourceBadge(ver.source)}`}
                    >
                      {sourceLabel(ver.source)}
                    </span>
                  </div>
                  <p className="text-[11px] text-gray-400 mt-0.5">
                    {formatDateTimeSGT(ver.createdAt)}
                  </p>
                </button>
              ))
            )}
          </div>

          {/* Preview pane */}
          <div className="flex-1 overflow-y-auto p-6">
            {loadingDetail ? (
              <p className="text-sm text-gray-400">Loading version...</p>
            ) : selectedVersion ? (
              <>
                <div className="flex items-center justify-between mb-4">
                  <div>
                    <span className="text-sm font-medium text-gray-700">
                      Version {selectedVersion.version}
                    </span>
                    <span
                      className={`ml-2 text-[10px] px-1.5 py-0.5 rounded ${sourceBadge(selectedVersion.source)}`}
                    >
                      {sourceLabel(selectedVersion.source)}
                    </span>
                  </div>
                  <button
                    onClick={handleRollback}
                    disabled={rolling}
                    className="px-3 py-1.5 text-xs bg-indigo-600 text-white rounded-lg hover:bg-indigo-700 disabled:opacity-50"
                  >
                    {rolling ? 'Restoring...' : 'Restore This Version'}
                  </button>
                </div>
                <div className="border border-gray-200 rounded-lg p-4">
                  <BlockRenderer content={selectedVersion.contentJson} />
                </div>
              </>
            ) : (
              <p className="text-sm text-gray-400">Select a version to preview</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
