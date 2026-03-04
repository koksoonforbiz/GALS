import { FileText, Image, Code, File } from 'lucide-react';
import { ProcessingBadge } from './ProcessingBadge';

interface StudentSourceDocument {
  id: string;
  fileName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  fileType: string;
  processingStatus: string;
  isActive: boolean;
  createdAt: string;
}

interface SourceCardProps {
  source: StudentSourceDocument;
  isActive: boolean;
  onToggle: (id: string, active: boolean) => void;
  onSelect: (source: StudentSourceDocument) => void;
  onDelete: (id: string) => void;
  onRetryProcessing?: (id: string) => void;
}

function fileIcon(fileType: string) {
  switch (fileType) {
    case 'PDF':
      return <FileText size={18} className="text-red-500" />;
    case 'IMAGE_PNG':
    case 'IMAGE_JPG':
    case 'IMAGE_WEBP':
      return <Image size={18} className="text-purple-500" />;
    case 'CODE':
      return <Code size={18} className="text-green-600" />;
    default:
      return <File size={18} className="text-gray-500" />;
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SourceCard({
  source,
  isActive,
  onToggle,
  onSelect,
  onDelete,
  onRetryProcessing,
}: SourceCardProps) {
  return (
    <div
      className={`group relative rounded-lg border p-3 transition-colors ${
        isActive ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="flex-shrink-0">{fileIcon(source.fileType)}</span>
        <div className="flex-1 min-w-0">
          <button
            onClick={() => onSelect(source)}
            className="text-sm font-medium text-gray-900 truncate block w-full text-left hover:text-blue-600"
            title={source.originalName}
          >
            {source.originalName}
          </button>
          <div className="flex items-center gap-2 mt-1">
            <span className="text-xs text-gray-500">{formatFileSize(source.fileSize)}</span>
            <ProcessingBadge status={source.processingStatus} />
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between mt-2">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={isActive}
            onChange={() => onToggle(source.id, !isActive)}
            className="rounded border-gray-300 text-blue-600 focus:ring-blue-500 h-3.5 w-3.5"
          />
          <span className="text-xs text-gray-500">Active</span>
        </label>

        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
          {source.processingStatus === 'COMPLETED' && (
            <button
              onClick={() => onSelect(source)}
              className="text-xs text-blue-600 hover:text-blue-800 px-1.5 py-0.5 rounded hover:bg-blue-50"
            >
              Guide
            </button>
          )}
          {source.processingStatus === 'FAILED' && onRetryProcessing && (
            <button
              onClick={() => onRetryProcessing(source.id)}
              className="text-xs text-amber-600 hover:text-amber-800 px-1.5 py-0.5 rounded hover:bg-amber-50"
            >
              Retry
            </button>
          )}
          <button
            onClick={() => onDelete(source.id)}
            className="text-xs text-red-500 hover:text-red-700 px-1.5 py-0.5 rounded hover:bg-red-50"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  );
}

export type { StudentSourceDocument };
