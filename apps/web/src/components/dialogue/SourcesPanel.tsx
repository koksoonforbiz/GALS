import { useCallback, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { useToast } from '../Toast';
import { SourceCard } from './SourceCard';
import type { StudentSourceDocument } from './SourceCard';

interface SourcesPanelProps {
  sources: StudentSourceDocument[];
  activeSourceIds: Set<string>;
  courseId: string;
  onToggleSource: (id: string, active: boolean) => void;
  onSourceSelect: (source: StudentSourceDocument) => void;
  onUploadComplete: (doc: StudentSourceDocument) => void;
  onDelete: (id: string) => void;
  processingDocumentIds: Set<string>;
}

export function SourcesPanel({
  sources,
  activeSourceIds,
  courseId,
  onToggleSource,
  onSourceSelect,
  onUploadComplete,
  onDelete,
}: SourcesPanelProps) {
  const { toast } = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);

  const activeCount = sources.filter((s) => activeSourceIds.has(s.id)).length;
  const allActive = activeCount === sources.length && sources.length > 0;

  const handleUpload = useCallback(
    async (files: FileList) => {
      setUploading(true);
      try {
        for (const file of Array.from(files)) {
          const formData = new FormData();
          formData.append('file', file);

          const token = localStorage.getItem('token');
          const res = await fetch(`/api/student-rag/courses/${courseId}/documents`, {
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
    [courseId, onUploadComplete, toast],
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
        {sources.length === 0 ? (
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
            />
          ))
        )}
      </div>

      {/* Footer with active count */}
      {sources.length > 0 && (
        <div className="p-3 border-t border-gray-200 flex items-center justify-between">
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
    </div>
  );
}
