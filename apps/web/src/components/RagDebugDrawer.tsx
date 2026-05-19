import { useState } from 'react';

interface ChunkInfo {
  id: string;
  documentId: string;
  documentTitle: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  tokenCount?: number;
  similarityScore: number;
  rerankerScore: number;
}

interface DebugInfo {
  totalChunksSearched: number;
  retrievalTimeMs: number;
  rerankTimeMs: number;
  generationTimeMs: number;
  model?: string;
  promptTokens?: number;
  completionTokens?: number;
}

interface Citation {
  chunkId: string;
  documentTitle: string;
  pageNumber: number | null;
  quote: string;
}

export interface RagDebugData {
  query: string;
  retrievedChunks: ChunkInfo[];
  finalChunks: ChunkInfo[];
  citations: Citation[];
  strictSourceValid: boolean;
  notEnoughInfo: boolean;
  debugInfo: DebugInfo;
}

interface Props {
  data: RagDebugData | null;
  isOpen: boolean;
  onClose: () => void;
}

export function RagDebugDrawer({ data, isOpen, onClose }: Props) {
  const [activeSection, setActiveSection] = useState<
    'overview' | 'retrieved' | 'final' | 'citations'
  >('overview');

  if (!isOpen || !data) return null;

  const sections = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'retrieved' as const, label: `Retrieved (${data.retrievedChunks.length})` },
    { key: 'final' as const, label: `Final (${data.finalChunks.length})` },
    { key: 'citations' as const, label: `Citations (${data.citations.length})` },
  ];

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white shadow-2xl border-l border-gray-200 z-50 flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-200 bg-gray-50">
        <div>
          <h3 className="text-sm font-bold text-gray-900">RAG Debug</h3>
          <p className="text-xs text-gray-500 mt-0.5 truncate max-w-[350px]">
            Query: &quot;{data.query}&quot;
          </p>
        </div>
        <button
          onClick={onClose}
          className="text-gray-400 hover:text-gray-600 text-lg"
        >
          &times;
        </button>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200">
        {sections.map((s) => (
          <button
            key={s.key}
            onClick={() => setActiveSection(s.key)}
            className={`flex-1 px-2 py-2 text-xs font-medium border-b-2 transition-colors ${
              activeSection === s.key
                ? 'border-indigo-600 text-indigo-600'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {s.label}
          </button>
        ))}
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeSection === 'overview' && (
          <div className="space-y-3">
            {/* Validation Status */}
            <div
              className={`p-3 rounded-lg border ${
                data.notEnoughInfo
                  ? 'bg-red-50 border-red-200'
                  : data.strictSourceValid
                    ? 'bg-green-50 border-green-200'
                    : 'bg-yellow-50 border-yellow-200'
              }`}
            >
              <p
                className={`text-sm font-medium ${
                  data.notEnoughInfo
                    ? 'text-red-800'
                    : data.strictSourceValid
                      ? 'text-green-800'
                      : 'text-yellow-800'
                }`}
              >
                {data.notEnoughInfo
                  ? 'NOT_ENOUGH_INFO - Sources insufficient'
                  : data.strictSourceValid
                    ? 'Strict-source validation passed'
                    : 'Strict-source validation: issues found'}
              </p>
            </div>

            {/* Performance Metrics */}
            <div className="bg-gray-50 rounded-lg p-3">
              <h4 className="text-xs font-semibold text-gray-600 mb-2">Performance</h4>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-gray-500">Retrieval:</span>{' '}
                  <span className="font-mono text-gray-900">
                    {data.debugInfo.retrievalTimeMs}ms
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Rerank:</span>{' '}
                  <span className="font-mono text-gray-900">{data.debugInfo.rerankTimeMs}ms</span>
                </div>
                <div>
                  <span className="text-gray-500">Generation:</span>{' '}
                  <span className="font-mono text-gray-900">
                    {data.debugInfo.generationTimeMs}ms
                  </span>
                </div>
                <div>
                  <span className="text-gray-500">Total chunks:</span>{' '}
                  <span className="font-mono text-gray-900">
                    {data.debugInfo.totalChunksSearched}
                  </span>
                </div>
              </div>
            </div>

            {/* Model Info */}
            {data.debugInfo.model && (
              <div className="bg-gray-50 rounded-lg p-3">
                <h4 className="text-xs font-semibold text-gray-600 mb-2">LLM</h4>
                <div className="grid grid-cols-2 gap-2 text-xs">
                  <div>
                    <span className="text-gray-500">Model:</span>{' '}
                    <span className="font-mono text-gray-900">{data.debugInfo.model}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Prompt tokens:</span>{' '}
                    <span className="font-mono text-gray-900">
                      {data.debugInfo.promptTokens ?? 'N/A'}
                    </span>
                  </div>
                  <div>
                    <span className="text-gray-500">Completion tokens:</span>{' '}
                    <span className="font-mono text-gray-900">
                      {data.debugInfo.completionTokens ?? 'N/A'}
                    </span>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}

        {activeSection === 'retrieved' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-2">
              All chunks retrieved before reranking, sorted by similarity score.
            </p>
            {data.retrievedChunks.map((chunk, i) => (
              <ChunkCard key={chunk.id} chunk={chunk} rank={i + 1} />
            ))}
          </div>
        )}

        {activeSection === 'final' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-2">
              Top-K chunks after reranking, passed to the LLM.
            </p>
            {data.finalChunks.map((chunk, i) => (
              <ChunkCard key={chunk.id} chunk={chunk} rank={i + 1} showFull />
            ))}
          </div>
        )}

        {activeSection === 'citations' && (
          <div className="space-y-3">
            <p className="text-xs text-gray-500 mb-2">
              Citations extracted from the generated answer.
            </p>
            {data.citations.length === 0 ? (
              <p className="text-sm text-gray-400">No citations found.</p>
            ) : (
              data.citations.map((citation, i) => (
                <div
                  key={i}
                  className="bg-white border border-gray-200 rounded-lg p-3"
                >
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-bold text-indigo-600">[{i + 1}]</span>
                    <span className="text-xs font-medium text-gray-900">
                      {citation.documentTitle}
                    </span>
                    {citation.pageNumber && (
                      <span className="text-xs text-gray-500">p.{citation.pageNumber}</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-600 italic">&quot;{citation.quote}&quot;</p>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ChunkCard({
  chunk,
  rank,
  showFull,
}: {
  chunk: ChunkInfo;
  rank: number;
  showFull?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const content = showFull || expanded ? chunk.content : chunk.content.slice(0, 200);

  return (
    <div className="bg-white border border-gray-200 rounded-lg p-3">
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-xs font-bold text-gray-400">#{rank}</span>
          <span className="text-xs font-medium text-gray-900">{chunk.documentTitle}</span>
          {chunk.pageNumber && (
            <span className="text-xs text-gray-500">p.{chunk.pageNumber}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs px-1.5 py-0.5 rounded bg-blue-100 text-blue-700">
            sim: {chunk.similarityScore.toFixed(3)}
          </span>
          <span className="text-xs px-1.5 py-0.5 rounded bg-purple-100 text-purple-700">
            rank: {chunk.rerankerScore.toFixed(3)}
          </span>
        </div>
      </div>
      <p className="text-xs text-gray-600 whitespace-pre-wrap">
        {content}
        {!showFull && chunk.content.length > 200 && !expanded && '...'}
      </p>
      {!showFull && chunk.content.length > 200 && (
        <button
          onClick={() => setExpanded(!expanded)}
          className="text-xs text-indigo-600 mt-1 hover:underline"
        >
          {expanded ? 'Show less' : 'Show more'}
        </button>
      )}
      {chunk.tokenCount != null && (
        <span className="text-xs text-gray-400 mt-1 block">
          {chunk.tokenCount} tokens &middot; chunk #{chunk.chunkIndex}
        </span>
      )}
    </div>
  );
}
