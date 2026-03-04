import { useCallback, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../Toast';
import { SourceCard } from './SourceCard';
import type { StudentSourceDocument } from './SourceCard';

interface ImportableDoc {
  id: string;
  originalName: string;
  fileType: string;
  fileSize: number;
  processingStatus: string;
  sessionId: string | null;
  session: { id: string; title: string } | null;
}

interface SourcesPanelProps {
  sources: StudentSourceDocument[];
  activeSourceIds: Set<string>;
  courseId: string;
  sessionId: string | null;
  onToggleSource: (id: string, active: boolean) => void;
  onSourceSelect: (source: StudentSourceDocument) => void;
  onUploadComplete: (doc: StudentSourceDocument) => void;
  onDelete: (id: string) => void;
  onImport: (documentIds: string[]) => Promise<void>;
  processingDocumentIds: Set<string>;
  isLoading?: boolean;
  onRetryProcessing?: (id: string) => void;
}

export function SourcesPanel({
  sources,
  activeSourceIds,
  courseId,
  sessionId,
  onToggleSource,
  onSourceSelect,
  onUploadComplete,
  onDelete,
  onImport,
  isLoading,
  onRetryProcessing,
}: SourcesPanelProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [importableDocs, setImportableDocs] = useState<ImportableDoc[]>([]);
  const [selectedImports, setSelectedImports] = useState<Set<string>>(new Set());
  const [loadingImportable, setLoadingImportable] = useState(false);

  const activeCount = sources.filter((s) => activeSourceIds.has(s.id)).length;
  const allActive = activeCount === sources.length && sources.length > 0;

  const handleUpload = useCallback(
    async (files: FileList) => {
      setUploading(true);
      try {
        const uploadUrl = sessionId
          ? `/api/student-rag/courses/${courseId}/documents?sessionId=${sessionId}`
          : `/api/student-rag/courses/${courseId}/documents`;
        for (const file of Array.from(files)) {
          const formData = new FormData();
          formData.append('file', file);

          const token = localStorage.getItem('token');
          const res = await fetch(uploadUrl, {
            method: 'POST',
            headers: token ? { Authorization: `Bearer ${token}` } : {},
            body: formData,
          });

          if (!res.ok) {
            const body = await res.json().catch(() => ({}));
            throw new Error(body.message || `Upload failed: ${res.status}`);
          }

          const doc = (await res.json()) as StudentSourceDocument;
          onUploadComplete(doc);
          toast('success', `Uploaded ${file.name}`);
        }
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Upload failed');
      } finally {
        setUploading(false);
      }
    },
    [courseId, sessionId, onUploadComplete, toast],
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      setIsDragging(false);
      if (e.dataTransfer.files.length > 0) {
        handleUpload(e.dataTransfer.files);
      }
    },
    [handleUpload],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  }, []);

  const handleDragLeave = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleToggleAll = useCallback(() => {
    for (const source of sources) {
      onToggleSource(source.id, !allActive);
    }
  }, [sources, allActive, onToggleSource]);

  const handleDeleteSource = useCallback(
    async (id: string) => {
      try {
        await api.delete(`/student-rag/documents/${id}`);
        onDelete(id);
        toast('success', 'Source deleted');
      } catch (err) {
        toast('error', err instanceof Error ? err.message : 'Delete failed');
      }
    },
    [onDelete, toast],
  );

  return (
    <div className="flex flex-col h-full">
      <div className="p-3 border-b border-gray-200">
        <h3 className="text-sm font-semibold text-gray-900">Sources</h3>
      </div>

      {/* Upload zone */}
      <div
        onDrop={handleDrop}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        className={`mx-3 mt-3 rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
          isDragging
            ? 'border-blue-400 bg-blue-50'
            : 'border-gray-300 hover:border-gray-400 bg-gray-50'
        }`}
      >
        {uploading ? (
          <div className="flex items-center justify-center gap-2">
            <div className="w-4 h-4 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            <span className="text-xs text-gray-600">Uploading...</span>
          </div>
        ) : (
          <>
            <p className="text-xs text-gray-500 mb-2">Drop files here or</p>
            <button
              onClick={() => fileInputRef.current?.click()}
              className="text-xs font-medium text-blue-600 hover:text-blue-700"
            >
              Upload Files
            </button>
            <input
              ref={fileInputRef}
              type="file"
              multiple
              onChange={(e) => e.target.files && handleUpload(e.target.files)}
              className="hidden"
              accept=".pdf,.docx,.doc,.txt,.md,.png,.jpg,.webp"
            />
          </>
        )}
      </div>

      {/* Source list */}
      <div className="flex-1 overflow-y-auto p-3 space-y-2">
        {isLoading ? (
          <>
            {[1, 2, 3].map((i) => (
              <div key={i} className="p-3 bg-gray-50 rounded-lg animate-pulse">
                <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
                <div className="h-3 bg-gray-200 rounded w-1/2" />
              </div>
            ))}
          </>
        ) : sources.length === 0 ? (
          <p className="text-xs text-gray-400 text-center py-4">
            No sources uploaded yet. Upload files to get started.
          </p>
        ) : (
          sources.map((source) => (
            <SourceCard
              key={source.id}
              source={source}
              isActive={activeSourceIds.has(source.id)}
              onToggle={onToggleSource}
              onSelect={onSourceSelect}
              onDelete={handleDeleteSource}
              onRetryProcessing={onRetryProcessing}
            />
          ))
        )}
      </div>

      {/* Footer with active count + import */}
      <div className="p-3 border-t border-gray-200">
        {sources.length > 0 && (
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs text-gray-500">
              {activeCount} of {sources.length} active
            </span>
            <button
              onClick={handleToggleAll}
              className="text-xs text-blue-600 hover:text-blue-700 font-medium"
            >
              {allActive ? 'Deselect All' : 'Select All'}
            </button>
          </div>
        )}
        {sessionId && (
          <button
            onClick={async () => {
              setShowImport(true);
              setLoadingImportable(true);
              try {
                const docs = await api.get<ImportableDoc[]>(
                  `/student-rag/courses/${courseId}/documents/importable?sessionId=${sessionId}`,
                );
                setImportableDocs(docs);
              } catch {
                toast('error', 'Failed to load documents');
              } finally {
                setLoadingImportable(false);
              }
            }}
            className="w-full text-xs text-center py-1.5 rounded border border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 transition-colors"
          >
            Import from other sessions
          </button>
        )}
      </div>

      {/* Import modal */}
      {showImport && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl p-5 max-w-md w-full mx-4 max-h-[70vh] flex flex-col">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold">Import Documents</h3>
              <button
                onClick={() => {
                  setShowImport(false);
                  setSelectedImports(new Set());
                }}
                className="text-gray-400 hover:text-gray-600"
              >
                &times;
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-1">
              {loadingImportable ? (
                <div className="text-center py-8">
                  <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              ) : importableDocs.length === 0 ? (
                <p className="text-xs text-gray-400 text-center py-8">
                  No documents in other sessions to import.
                </p>
              ) : (
                importableDocs.map((doc) => (
                  <label
                    key={doc.id}
                    className="flex items-center gap-2 p-2 rounded border border-gray-200 hover:bg-gray-50 cursor-pointer"
                  >
                    <input
                      type="checkbox"
                      checked={selectedImports.has(doc.id)}
                      onChange={(e) => {
                        setSelectedImports((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(doc.id) : next.delete(doc.id);
                          return next;
                        });
                      }}
                      className="rounded border-gray-300"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="text-xs font-medium truncate">{doc.originalName}</div>
                      <div className="text-xs text-gray-400">
                        From: {doc.session?.title || 'No session'}
                      </div>
                    </div>
                  </label>
                ))
              )}
            </div>

            <div className="flex justify-end gap-2 mt-3 pt-3 border-t border-gray-200">
              <button
                onClick={() => {
                  setShowImport(false);
                  setSelectedImports(new Set());
                }}
                className="text-xs px-3 py-1.5 rounded border border-gray-300 text-gray-600 hover:bg-gray-50"
              >
                Cancel
              </button>
              <button
                disabled={selectedImports.size === 0}
                onClick={async () => {
                  await onImport([...selectedImports]);
                  setShowImport(false);
                  setSelectedImports(new Set());
                }}
                className="text-xs px-3 py-1.5 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed"
              >
                Import ({selectedImports.size})
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
