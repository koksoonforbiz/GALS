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
}

function fileIcon(fileType: string): string {
  switch (fileType) {
    case 'PDF':
      return '\u{1F4C4}';
    case 'IMAGE_PNG':
    case 'IMAGE_JPG':
    case 'IMAGE_WEBP':
      return '\u{1F5BC}';
    case 'CODE':
      return '</>';
    default:
      return '\u{1F4DD}';
  }
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function SourceCard({ source, isActive, onToggle, onSelect, onDelete }: SourceCardProps) {
  return (
    <div
      className={`group relative rounded-lg border p-3 transition-colors ${
        isActive ? 'border-blue-300 bg-blue-50/50' : 'border-gray-200 bg-white'
      }`}
    >
      <div className="flex items-start gap-2">
        <span className="text-lg flex-shrink-0">{fileIcon(source.fileType)}</span>
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
