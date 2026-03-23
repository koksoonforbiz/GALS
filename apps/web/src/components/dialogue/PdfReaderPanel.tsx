import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import {
  ArrowLeft,
  ZoomIn,
  ZoomOut,
  RotateCw,
  FileText,
  Loader2,
  AlertCircle,
  Lightbulb,
  MessageSquare,
  List,
  CalendarDays,
  Bookmark,
  Highlighter,
} from 'lucide-react';

type InterventionStrategy =
  | 'practice_testing'
  | 'elaboration'
  | 'stepwise'
  | 'distributed_practice';

interface HighlightEntry {
  id: string;
  text: string;
  pageNumber: number | null;
  color: string;
}

interface PdfReaderPanelProps {
  documentId: string;
  documentName: string;
  documentUrl: string;
  onClose: () => void;
  onSendToIntervention: (text: string, strategy: InterventionStrategy) => void;
  onSaveHighlightToNotes: (text: string, pageNumber?: number, color?: string) => void;
  highlights?: HighlightEntry[];
}

export function PdfReaderPanel({
  documentName,
  documentUrl,
  onClose,
  onSendToIntervention,
  onSaveHighlightToNotes,
  highlights = [],
}: PdfReaderPanelProps) {
  const [numPages, setNumPages] = useState<number>(0);
  const [currentPage, setCurrentPage] = useState<number>(1);
  const [scale, setScale] = useState<number>(1.0);
  const [rotation, setRotation] = useState<number>(0);
  const [loadError, setLoadError] = useState<boolean>(false);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Selection state for popup
  const [selection, setSelection] = useState<{
    text: string;
    boundingRect: DOMRect;
  } | null>(null);

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setIsLoading(false);
    setLoadError(false);
  }, []);

  const onDocumentLoadError = useCallback(() => {
    setLoadError(true);
    setIsLoading(false);
  }, []);

  // Track current page on scroll
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container || numPages === 0) return;

    const handleScroll = () => {
      const containerRect = container.getBoundingClientRect();
      const containerMid = containerRect.top + containerRect.height / 2;
      let closest = 1;
      let minDist = Infinity;

      pageRefs.current.forEach((el, pageNum) => {
        const rect = el.getBoundingClientRect();
        const pageMid = rect.top + rect.height / 2;
        const dist = Math.abs(pageMid - containerMid);
        if (dist < minDist) {
          minDist = dist;
          closest = pageNum;
        }
      });

      setCurrentPage(closest);
    };

    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => container.removeEventListener('scroll', handleScroll);
  }, [numPages]);

  // Text selection detection
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      const sel = window.getSelection();
      if (!sel || sel.toString().trim().length <= 10) {
        return;
      }
      const text = sel.toString().trim();
      const range = sel.getRangeAt(0);
      const rect = range.getBoundingClientRect();
      setSelection({ text, boundingRect: rect });
    };

    const handleMouseDown = () => {
      setSelection(null);
    };

    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mousedown', handleMouseDown);
    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mousedown', handleMouseDown);
    };
  }, []);

  // Dismiss selection on Escape
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setSelection(null);
        window.getSelection()?.removeAllRanges();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  const handleZoomIn = () => setScale((s) => Math.min(2.5, s + 0.25));
  const handleZoomOut = () => setScale((s) => Math.max(0.5, s - 0.25));
  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const handleSendToIntervention = (text: string, strategy: InterventionStrategy) => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    onSendToIntervention(text, strategy);
  };

  const handleSaveToNotes = (text: string, color?: string) => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
    onSaveHighlightToNotes(text, currentPage, color);
  };

  // Group highlights by page number for overlay rendering
  const highlightsByPage = useMemo(() => {
    const map = new Map<number, HighlightEntry[]>();
    for (const h of highlights) {
      const page = h.pageNumber ?? 1;
      if (!map.has(page)) map.set(page, []);
      map.get(page)!.push(h);
    }
    return map;
  }, [highlights]);

  const handleDismissSelection = () => {
    setSelection(null);
    window.getSelection()?.removeAllRanges();
  };

  // Configure cMaps and standard fonts so pdfjs can extract text from all PDFs
  const documentOptions = useMemo(
    () => ({
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
    }),
    [],
  );

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="h-12 flex items-center justify-between px-3 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-2">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-sm text-gray-600 hover:text-gray-900 rounded-md p-1.5 hover:bg-gray-100 transition-colors"
          >
            <ArrowLeft size={16} />
            <span>Back to Chat</span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 min-w-0">
          <FileText size={14} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-700 truncate max-w-[200px]">{documentName}</span>
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={handleZoomOut}
            disabled={scale <= 0.5}
            className="rounded-md p-1.5 hover:bg-gray-100 transition-colors disabled:opacity-50"
            title="Zoom out"
          >
            <ZoomOut size={16} className="text-gray-600" />
          </button>
          <span className="text-xs text-gray-500 font-mono w-12 text-center">
            {Math.round(scale * 100)}%
          </span>
          <button
            onClick={handleZoomIn}
            disabled={scale >= 2.5}
            className="rounded-md p-1.5 hover:bg-gray-100 transition-colors disabled:opacity-50"
            title="Zoom in"
          >
            <ZoomIn size={16} className="text-gray-600" />
          </button>
          <button
            onClick={handleRotate}
            className="rounded-md p-1.5 hover:bg-gray-100 transition-colors"
            title="Rotate"
          >
            <RotateCw size={16} className="text-gray-600" />
          </button>
          <span className="text-sm text-gray-600 font-mono ml-2">
            {currentPage} / {numPages}
          </span>
        </div>
      </div>

      {/* PDF display area */}
      <div ref={scrollContainerRef} className="flex-1 bg-gray-100 overflow-y-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={32} className="text-blue-600 animate-spin" />
          </div>
        )}

        {loadError && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <AlertCircle size={32} className="text-red-500 mb-3" />
            <p className="text-sm text-gray-700">Could not load PDF. Please try again.</p>
            <button onClick={onClose} className="mt-3 text-sm text-blue-600 hover:text-blue-700">
              Back to Chat
            </button>
          </div>
        )}

        {!loadError && (
          <Document
            file={documentUrl}
            onLoadSuccess={onDocumentLoadSuccess}
            onLoadError={onDocumentLoadError}
            options={documentOptions}
            loading={null}
          >
            <div className="flex flex-col items-center gap-4 py-4">
              {Array.from({ length: numPages }, (_, i) => i + 1).map((pageNum) => (
                <div
                  key={pageNum}
                  ref={(el) => {
                    if (el) pageRefs.current.set(pageNum, el);
                  }}
                  className="bg-white shadow-md rounded mx-auto relative"
                >
                  <Page
                    pageNumber={pageNum}
                    scale={scale}
                    rotate={rotation}
                    renderTextLayer={true}
                    renderAnnotationLayer={true}
                  />
                  {/* Highlight indicators for this page */}
                  {(highlightsByPage.get(pageNum) || []).length > 0 && (
                    <div className="absolute top-1 right-1 z-10 flex flex-col gap-1">
                      {(highlightsByPage.get(pageNum) || []).map((h) => (
                        <div
                          key={h.id}
                          className="flex items-center gap-1 px-1.5 py-0.5 rounded text-xs shadow-sm border border-gray-200 bg-white/90 max-w-[180px]"
                          title={h.text}
                        >
                          <Highlighter
                            size={10}
                            style={{ color: HIGHLIGHT_COLORS[h.color] || HIGHLIGHT_COLORS.yellow }}
                          />
                          <span className="truncate text-gray-600">
                            {h.text.slice(0, 40)}
                            {h.text.length > 40 ? '...' : ''}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </Document>
        )}

        {/* Selection popup */}
        {selection && (
          <SelectionPopup
            selection={selection}
            onSendToIntervention={handleSendToIntervention}
            onSaveToNotes={handleSaveToNotes}
            onDismiss={handleDismissSelection}
          />
        )}
      </div>
    </div>
  );
}

// ─── Highlight color mapping ─────────────────────────────

const HIGHLIGHT_COLORS: Record<string, string> = {
  yellow: '#facc15',
  green: '#4ade80',
  blue: '#60a5fa',
  pink: '#f472b6',
  purple: '#a78bfa',
};

// ─── Selection Popup ─────────────────────────────────────

interface SelectionPopupProps {
  selection: { text: string; boundingRect: DOMRect };
  onSendToIntervention: (text: string, strategy: InterventionStrategy) => void;
  onSaveToNotes: (text: string, color?: string) => void;
  onDismiss: () => void;
}

function SelectionPopup({
  selection,
  onSendToIntervention,
  onSaveToNotes,
  onDismiss,
}: SelectionPopupProps) {
  const popupRef = useRef<HTMLDivElement>(null);
  const [showHighlightColors, setShowHighlightColors] = useState(false);

  // Position calculation
  const { boundingRect, text } = selection;
  const popupHeight = showHighlightColors ? 220 : 190;
  const top = Math.max(8, boundingRect.top - popupHeight - 8);
  const left = Math.max(
    8,
    Math.min(window.innerWidth - 240, boundingRect.left + boundingRect.width / 2 - 120),
  );

  // Click outside to dismiss
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (popupRef.current && !popupRef.current.contains(e.target as Node)) {
        onDismiss();
      }
    };
    // Delay so the popup doesn't immediately dismiss
    const timer = setTimeout(() => {
      document.addEventListener('mousedown', handleClickOutside);
    }, 100);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [onDismiss]);

  return (
    <div
      ref={popupRef}
      className="fixed z-50 bg-white border border-gray-200 rounded-lg shadow-xl p-2 flex flex-col gap-1 min-w-[220px]"
      style={{ top, left }}
    >
      {/* Selected text preview */}
      <div className="px-3 py-1.5 text-xs text-gray-400 italic truncate border-b border-gray-100 mb-1">
        &quot;{text.slice(0, 60)}
        {text.length > 60 ? '...' : ''}&quot;
      </div>

      {/* Highlight & Note section */}
      <button
        onClick={() => setShowHighlightColors(!showHighlightColors)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-amber-50 text-amber-600 w-full text-left transition-colors font-medium"
      >
        <Highlighter size={14} />
        Highlight &amp; Note
      </button>
      {showHighlightColors && (
        <div className="flex items-center gap-1.5 px-3 py-1.5">
          {Object.entries(HIGHLIGHT_COLORS).map(([name, hex]) => (
            <button
              key={name}
              onClick={() => onSaveToNotes(text, name)}
              className="w-6 h-6 rounded-full border-2 border-gray-200 hover:border-gray-500 hover:scale-110 transition-all"
              style={{ backgroundColor: hex }}
              title={`Highlight ${name}`}
            />
          ))}
        </div>
      )}

      <button
        onClick={() => onSaveToNotes(text)}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-amber-50 text-amber-600 w-full text-left transition-colors"
      >
        <Bookmark size={14} />
        Save to Notes
      </button>

      <div className="border-t border-gray-100 my-1" />

      {/* Intervention strategies */}
      <button
        onClick={() => onSendToIntervention(text, 'practice_testing')}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-indigo-50 text-gray-700 w-full text-left transition-colors"
      >
        <Lightbulb size={14} />
        Practice Test
      </button>
      <button
        onClick={() => onSendToIntervention(text, 'elaboration')}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-indigo-50 text-gray-700 w-full text-left transition-colors"
      >
        <MessageSquare size={14} />
        Explain
      </button>
      <button
        onClick={() => onSendToIntervention(text, 'stepwise')}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-indigo-50 text-gray-700 w-full text-left transition-colors"
      >
        <List size={14} />
        Step-by-step
      </button>
      <button
        onClick={() => onSendToIntervention(text, 'distributed_practice')}
        className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-md hover:bg-indigo-50 text-gray-700 w-full text-left transition-colors"
      >
        <CalendarDays size={14} />
        Spaced Rep
      </button>
    </div>
  );
}

export type { PdfReaderPanelProps, InterventionStrategy, HighlightEntry };
