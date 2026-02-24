import type { DiagramBlockData } from '../block-types';

interface Props {
  data: DiagramBlockData;
  onChange: (data: DiagramBlockData) => void;
  readOnly?: boolean;
}

export default function DiagramBlock({ data, onChange, readOnly }: Props) {
  if (readOnly) {
    return (
      <div className="bg-gray-50 border border-gray-200 rounded-lg p-4 text-center text-sm text-gray-400">
        Diagram block (Mermaid support removed)
      </div>
    );
  }

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      <div className="px-3 py-1.5 bg-gray-50 border-b border-gray-200">
        <span className="text-xs font-medium text-gray-600">Diagram (Mermaid support removed)</span>
      </div>
      <div className="p-3">
        <textarea
          value={data.code}
          onChange={(e) => onChange({ code: e.target.value })}
          className="w-full h-32 px-3 py-2 text-sm font-mono resize-none border border-gray-200 rounded focus:outline-none focus:ring-1 focus:ring-blue-300"
          placeholder="Mermaid diagram code (rendering disabled)"
          spellCheck={false}
        />
      </div>
    </div>
  );
}
