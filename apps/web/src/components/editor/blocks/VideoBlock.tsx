import { useState, useMemo } from 'react';
import type { VideoBlockData } from '../block-types';

interface Props {
  data: VideoBlockData;
  onChange: (data: VideoBlockData) => void;
  readOnly?: boolean;
}

function parseVideoEmbed(url: string, startTime: number): string | null {
  if (!url) return null;

  // YouTube
  const ytMatch = url.match(
    /(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([a-zA-Z0-9_-]{11})/,
  );
  if (ytMatch) {
    const t = startTime > 0 ? `&start=${startTime}` : '';
    return `https://www.youtube.com/embed/${ytMatch[1]}?rel=0${t}`;
  }

  // Vimeo
  const vmMatch = url.match(/vimeo\.com\/(\d+)/);
  if (vmMatch) {
    const t = startTime > 0 ? `#t=${startTime}s` : '';
    return `https://player.vimeo.com/video/${vmMatch[1]}${t}`;
  }

  return null;
}

export default function VideoBlock({ data, onChange, readOnly }: Props) {
  const [urlInput, setUrlInput] = useState(data.url);

  const embedUrl = useMemo(() => parseVideoEmbed(data.url, data.startTime), [data.url, data.startTime]);

  const handleSubmit = () => {
    onChange({ ...data, url: urlInput.trim() });
  };

  if (!data.url && !readOnly) {
    return (
      <div className="border-2 border-dashed border-gray-300 rounded-lg p-6 text-center">
        <p className="text-sm text-gray-500 mb-3">Embed a YouTube or Vimeo video</p>
        <div className="flex gap-2 justify-center">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            placeholder="https://youtube.com/watch?v=..."
            className="px-3 py-1.5 text-sm border border-gray-300 rounded-lg w-80"
            onKeyDown={(e) => e.key === 'Enter' && handleSubmit()}
          />
          <button
            onClick={handleSubmit}
            className="px-3 py-1.5 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700"
          >
            Embed
          </button>
        </div>
      </div>
    );
  }

  return (
    <div>
      {embedUrl ? (
        <div className="relative w-full" style={{ paddingBottom: '56.25%' }}>
          <iframe
            src={embedUrl}
            className="absolute top-0 left-0 w-full h-full rounded-lg"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            title="Embedded video"
          />
        </div>
      ) : data.url ? (
        <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
          Could not parse video URL: {data.url}
        </div>
      ) : null}

      {!readOnly && data.url && (
        <div className="mt-2 flex items-center gap-2 text-xs">
          <input
            type="url"
            value={urlInput}
            onChange={(e) => setUrlInput(e.target.value)}
            onBlur={handleSubmit}
            placeholder="Video URL"
            className="px-2 py-1 border border-gray-200 rounded text-xs flex-1"
          />
          <label className="flex items-center gap-1">
            Start (s):
            <input
              type="number"
              min={0}
              value={data.startTime}
              onChange={(e) => onChange({ ...data, startTime: parseInt(e.target.value) || 0 })}
              className="px-2 py-1 border border-gray-200 rounded text-xs w-16"
            />
          </label>
          <button
            onClick={() => {
              onChange({ ...data, url: '' });
              setUrlInput('');
            }}
            className="px-2 py-1 bg-red-100 text-red-600 rounded hover:bg-red-200"
          >
            Remove
          </button>
        </div>
      )}
    </div>
  );
}
