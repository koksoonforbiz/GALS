import { useState, useRef } from 'react';
import type { ImageBlockData } from '../block-types';

interface Props {
  data: ImageBlockData;
  onChange: (data: ImageBlockData) => void;
  readOnly?: boolean;
}

export default function ImageBlock({ data, onChange, readOnly }: Props) {
  const [uploading, setUploading] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [showUrlInput, setShowUrlInput] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (file: File) => {
    setUploading(true);
    try {
      // Convert to data URL for now (works without backend changes)
      // In production, use presigned upload to blob storage
      const reader = new FileReader();
      reader.onload = () => {
        onChange({ ...data, src: reader.result as string, alt: data.alt || file.name });
        setUploading(false);
      };
      reader.onerror = () => {
        setUploading(false);
      };
      reader.readAsDataURL(file);
    } catch {
      setUploading(false);
    }
  };

  const handleUrlSubmit = () => {
    if (urlInput.trim()) {
      onChange({ ...data, src: urlInput.trim() });
      setShowUrlInput(false);
      setUrlInput('');
    }
  };

  if (!data.src && !readOnly) {
    return (
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <p className="text-sm text-gray-500 mb-3">Add an image</p>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploading}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
          >
            {uploading ? 'Uploading...' : 'Upload File'}
          </button>
          <button
            onClick={() => setShowUrlInput(!showUrlInput)}
            className="px-3 py-1.5 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200"
          >
            Paste URL
          </button>
        </div>
        {showUrlInput && (
          <div className="mt-3 flex gap-2 justify-center">
            <input
              type="url"
              value={urlInput}
              onChange={(e) => setUrlInput(e.target.value)}
              placeholder="https://example.com/image.png"
              className="px-2 py-1 text-sm border border-gray-300 rounded-lg w-72"
              onKeyDown={(e) => e.key === 'Enter' && handleUrlSubmit()}
            />
            <button
              onClick={handleUrlSubmit}
              className="px-3 py-1 text-sm bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              Add
            </button>
          </div>
        )}
        <input
          ref={fileRef}
          type="file"
          accept="image/png,image/jpeg,image/svg+xml,image/webp"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
          }}
        />
      </div>
    );
  }

  const sizeClass =
    data.size === 'small' ? 'max-w-xs' : data.size === 'full' ? 'w-full' : 'max-w-lg';
  const alignClass =
    data.align === 'left' ? '' : data.align === 'right' ? 'ml-auto' : 'mx-auto';

  return (
    <div>
      {data.src && (
        <figure className={`${sizeClass} ${alignClass}`}>
          <img
            src={data.src}
            alt={data.alt || ''}
            className="rounded-lg w-full"
          />
          {data.caption && (
            <figcaption className="text-xs text-gray-500 text-center mt-1 italic">
              {data.caption}
            </figcaption>
          )}
        </figure>
      )}

      {!readOnly && data.src && (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <input
            type="text"
            value={data.caption}
            onChange={(e) => onChange({ ...data, caption: e.target.value })}
            placeholder="Caption (optional)"
            className="px-2 py-1 border border-gray-200 rounded text-xs w-40"
          />
          <input
            type="text"
            value={data.alt}
            onChange={(e) => onChange({ ...data, alt: e.target.value })}
            placeholder="Alt text"
            className="px-2 py-1 border border-gray-200 rounded text-xs w-32"
          />
          <select
            value={data.size}
            onChange={(e) => onChange({ ...data, size: e.target.value as ImageBlockData['size'] })}
            className="px-2 py-1 border border-gray-200 rounded text-xs"
          >
            <option value="small">Small</option>
            <option value="medium">Medium</option>
            <option value="full">Full width</option>
          </select>
          <select
            value={data.align}
            onChange={(e) => onChange({ ...data, align: e.target.value as ImageBlockData['align'] })}
            className="px-2 py-1 border border-gray-200 rounded text-xs"
          >
            <option value="left">Left</option>
            <option value="center">Center</option>
            <option value="right">Right</option>
          </select>
          <button
            onClick={() => onChange({ ...data, src: '' })}
            className="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
