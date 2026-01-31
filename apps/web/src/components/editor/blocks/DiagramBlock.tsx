import { useState, useEffect, useRef, useCallback } from 'react';
import mermaid from 'mermaid';
import type { DiagramBlockData } from '../block-types';

mermaid.initialize({
  startOnLoad: false,
  theme: 'default',
  securityLevel: 'loose',
});

interface Props {
  data: DiagramBlockData;
  onChange: (data: DiagramBlockData) => void;
  readOnly?: boolean;
}

let renderCounter = 0;

export default function DiagramBlock({ data, onChange, readOnly }: Props) {
  const [editing, setEditing] = useState(!data.code || !readOnly);
  const [localCode, setLocalCode] = useState(data.code);
  const [svgHtml, setSvgHtml] = useState('');
  const [error, setError] = useState('');
  const previewRef = useRef<HTMLDivElement>(null);

  const renderDiagram = useCallback(async (code: string) => {
    if (!code.trim()) {
      setSvgHtml('');
      setError('');
      return;
    }
    try {
      const id = `mermaid-${++renderCounter}`;
      const { svg } = await mermaid.render(id, code);
      setSvgHtml(svg);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Invalid Mermaid syntax');
      setSvgHtml('');
    }
  }, []);

  // Render on mount and when code changes
  useEffect(() => {
    renderDiagram(data.code);
  }, [data.code, renderDiagram]);

  // Debounced live preview while editing
  useEffect(() => {
    if (!editing) return;
    const timer = setTimeout(() => renderDiagram(localCode), 500);
    return () => clearTimeout(timer);
  }, [localCode, editing, renderDiagram]);

  const handleDone = () => {
    onChange({ code: localCode });
    setEditing(false);
  };

  if (readOnly || !editing) {
    return (
      <div
        className="relative group"
        onClick={() => !readOnly && setEditing(true)}
      >
        {svgHtml ? (
          <div
            ref={previewRef}
            className="flex justify-center p-4 bg-white rounded-lg border border-gray-200 cursor-pointer"
            dangerouslySetInnerHTML={{ __html: svgHtml }}
          />
        ) : error ? (
          <div className="bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
            Diagram error: {error}
          </div>
        ) : (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-400">
            Empty diagram
          </div>
        )}
        {!readOnly && (
          <div className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity">
            <button className="text-xs px-2 py-1 bg-white border border-gray-200 rounded shadow-sm">
              Edit
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-medium text-gray-600">Mermaid Diagram</span>
        <button
          onClick={handleDone}
          className="text-xs px-2 py-1 bg-blue-600 text-white rounded hover:bg-blue-700"
        >
          Done
        </button>
      </div>
      <div className="grid grid-cols-2 gap-0 divide-x divide-gray-200">
        <div>
          <textarea
            value={localCode}
            onChange={(e) => setLocalCode(e.target.value)}
            className="w-full h-48 px-3 py-2 text-sm font-mono resize-none focus:outline-none"
            placeholder="graph TD&#10;  A[Start] --> B[End]"
            spellCheck={false}
          />
        </div>
        <div className="p-3 bg-white min-h-[12rem] flex items-center justify-center overflow-auto">
          {svgHtml ? (
            <div dangerouslySetInnerHTML={{ __html: svgHtml }} />
          ) : error ? (
            <p className="text-xs text-red-500">{error}</p>
          ) : (
            <p className="text-xs text-gray-400">Preview</p>
          )}
        </div>
      </div>
    </div>
  );
}
