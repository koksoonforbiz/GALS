interface Citation {
  chunkId: string;
  documentId: string;
  documentName: string;
  pageNumber: number | null;
  excerpt: string;
  score: number;
}

interface CitationChipProps {
  citation: Citation;
  onClick: (c: Citation) => void;
}

export function CitationChip({ citation, onClick }: CitationChipProps) {
  const label = citation.pageNumber
    ? `${citation.documentName} p.${citation.pageNumber}`
    : citation.documentName;

  return (
    <button
      onClick={() => onClick(citation)}
      title={citation.excerpt}
      className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-blue-50 text-blue-700 text-xs font-medium hover:bg-blue-100 transition-colors cursor-pointer border border-blue-200"
    >
      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z"
        />
      </svg>
      {label}
    </button>
  );
}

export type { Citation, CitationChipProps };
