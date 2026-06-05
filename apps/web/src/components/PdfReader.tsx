import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { Document, Page, pdfjs } from 'react-pdf';
import { RotateCw, FileText, Loader2, AlertCircle } from 'lucide-react';

/**
 * Slim, reusable PDF reader. Renders a scrollable multi-page document via
 * react-pdf and surfaces the user's text selection through a callback.
 *
 * Deliberately does NOT carry over the dialogue-mode highlight/notes UI —
 * that lives in PdfReaderPanel.tsx and is specific to the dialogue surface.
 * If you need highlights, use PdfReaderPanel; if you just want "show this
 * PDF and tell me what the student selected", use this.
 */
interface PdfReaderProps {
  documentUrl: string;
  documentName?: string;
  /** Fired whenever the user finishes a non-trivial selection (>10 chars). */
  onTextSelected?: (text: string, pageNumber: number | null) => void;
  /** Fired whenever the selection is cleared (mousedown elsewhere, Escape). */
  onSelectionCleared?: () => void;
  /** When true, surfaces the visible/current PDF page text as selected context. */
  autoSelectCurrentPage?: boolean;
  /**
   * P3 — fires when the PDF's metadata is known (numPages) and on
   * page changes. Parent surfaces (e.g. StudentCourseViewPage) lift
   * this into PageContext so intervention views can default the
   * page-range upper bound to the document's last page.
   */
  onPdfMeta?: (meta: { currentPage: number; numPages: number }) => void;
  onCurrentPageText?: (meta: { pageNumber: number; text: string }) => void;
  /**
   * Per-page highlight checkboxes. Multiple pages can be checked simultaneously.
   * The parent receives each toggle via onPageChecked.
   */
  checkedPages?: ReadonlySet<number>;
  onPageChecked?: (pageNum: number, checked: boolean, pageText: string) => void;
  className?: string;
}

export function PdfReader({
  documentUrl,
  documentName,
  onTextSelected,
  onSelectionCleared,
  autoSelectCurrentPage = false,
  onPdfMeta,
  onCurrentPageText,
  checkedPages,
  onPageChecked,
  className = '',
}: PdfReaderProps) {
  const [numPages, setNumPages] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  // Zoom is intentionally disabled — see comment above the toolbar.
  // The PDF is rendered at the column's CSS width via <Page width={...}>
  // (no `scale` prop), so it always fits the column without a manual
  // zoom step. Removing the zoom buttons fixed a flicker / "Maximum
  // update depth exceeded" loop where zooming caused rapid
  // ResizeObserver → containerWidth → page-render cycles.
  const scale = 1.0;
  const [rotation, setRotation] = useState(0);
  const [loadError, setLoadError] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  // Container width drives the rendered Page width so the PDF reflows
  // to fit the column rather than overflowing horizontally. Without
  // this, a wide PDF would push the whole three-column page out past
  // the viewport at any browser zoom level.
  const [containerWidth, setContainerWidth] = useState<number>(0);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const pageRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  // Observe the scroll container's content-box width and feed it to
  // <Page width={...}>. ResizeObserver fires on browser zoom, window
  // resize, divider drag, and devtools toggling — anything that
  // changes the column's CSS width.
  useEffect(() => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const update = () => {
      // Subtract a few px for internal padding so the page stays
      // comfortably inside the column instead of touching the scroll
      // gutter or the column border.
      const w = el.clientWidth - 24;
      if (w > 0) setContainerWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Hold the latest onPdfMeta callback in a ref so internal effects
  // can call it WITHOUT putting it in their dependency arrays. Callers
  // commonly pass an inline lambda (`onPdfMeta={({n})=>setX(n)}`)
  // which creates a new function reference every render — depending
  // on it directly created a feedback loop: effect fires → setX →
  // parent re-renders → new lambda → effect re-fires → "Maximum
  // update depth exceeded". Zoom is the visible trigger because
  // react-pdf re-renders pages on scale change, accelerating the
  // cycle into the observable flicker.
  const onPdfMetaRef = useRef(onPdfMeta);
  useEffect(() => {
    onPdfMetaRef.current = onPdfMeta;
  }, [onPdfMeta]);
  const onCurrentPageTextRef = useRef(onCurrentPageText);
  useEffect(() => {
    onCurrentPageTextRef.current = onCurrentPageText;
  }, [onCurrentPageText]);

  const onDocumentLoadSuccess = useCallback(({ numPages: total }: { numPages: number }) => {
    setNumPages(total);
    setIsLoading(false);
    setLoadError(false);
    // P3 — lift numPages so consumers can default page-range
    // inputs without re-parsing the PDF.
    onPdfMetaRef.current?.({ currentPage: 1, numPages: total });
  }, []);

  // P3 — surface every page change too so the meta callback can
  // track scroll position if a consumer cares (PracticeTestingView
  // only uses numPages, but keeping currentPage in the contract
  // future-proofs other surfaces).
  useEffect(() => {
    if (numPages > 0) onPdfMetaRef.current?.({ currentPage, numPages });
  }, [currentPage, numPages]);

  const onDocumentLoadError = useCallback(() => {
    setLoadError(true);
    setIsLoading(false);
  }, []);

  // Track current page by detecting which page's centre is closest to the
  // viewport centre as the user scrolls.
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

  // Surface text selection. We hook mouseup on the scroll container so we
  // only react to selections inside the PDF, not the rest of the page.
  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const handleMouseUp = () => {
      const sel = window.getSelection();
      const text = sel?.toString().trim() ?? '';
      if (text.length <= 10) return;
      onTextSelected?.(text, currentPage);
    };

    const handleMouseDown = () => {
      if (autoSelectCurrentPage) return;
      onSelectionCleared?.();
    };

    container.addEventListener('mouseup', handleMouseUp);
    container.addEventListener('mousedown', handleMouseDown);
    return () => {
      container.removeEventListener('mouseup', handleMouseUp);
      container.removeEventListener('mousedown', handleMouseDown);
    };
  }, [onTextSelected, onSelectionCleared, currentPage, autoSelectCurrentPage]);

  useEffect(() => {
    if (!autoSelectCurrentPage || numPages === 0) return;

    const selectCurrentPageText = () => {
      const pageEl = pageRefs.current.get(currentPage);
      const textLayer = pageEl?.querySelector('.textLayer');
      const text = textLayer?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      if (text.length > 10) onTextSelected?.(text, currentPage);
    };

    const timeout = window.setTimeout(selectCurrentPageText, 250);
    return () => window.clearTimeout(timeout);
  }, [autoSelectCurrentPage, currentPage, numPages, rotation, containerWidth, onTextSelected]);

  useEffect(() => {
    if (numPages === 0) return;

    const publishCurrentPageText = () => {
      const pageEl = pageRefs.current.get(currentPage);
      const textLayer = pageEl?.querySelector('.textLayer');
      const text = textLayer?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
      onCurrentPageTextRef.current?.({ pageNumber: currentPage, text });
    };

    const timeout = window.setTimeout(publishCurrentPageText, 250);
    return () => window.clearTimeout(timeout);
  }, [currentPage, numPages, rotation, containerWidth]);

  // Escape clears the in-browser selection too.
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        window.getSelection()?.removeAllRanges();
        onSelectionCleared?.();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onSelectionCleared]);

  const handleRotate = () => setRotation((r) => (r + 90) % 360);

  const documentOptions = useMemo(
    () => ({
      cMapUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/cmaps/`,
      cMapPacked: true,
      standardFontDataUrl: `https://unpkg.com/pdfjs-dist@${pdfjs.version}/standard_fonts/`,
    }),
    [],
  );

  return (
    // data-replay-pdf-current-page / data-replay-pdf-total-pages give
    // the session-replay recorder a clean semantic anchor for the PDF's
    // reading position. The recorder reads these attributes in
    // capturePdfState() so the replay can (a) emit per-snapshot
    // pdf_current_page / pdf_total_pages columns for CSV export and
    // (b) fall back to scrollIntoView'ing the matching page wrapper
    // inside the iframe when the captured scrollTop doesn't restore
    // cleanly (canvas → <img> replacements may still be decoding at
    // iframe onLoad). All pages are rendered (NOT virtualized), so the
    // page wrappers below carry data-replay-pdf-page=<n> for that
    // fallback to work.
    <div
      className={`flex flex-col h-full ${className}`}
      data-replay-pdf-current-page={currentPage}
      data-replay-pdf-total-pages={numPages}
    >
      {/* Toolbar */}
      <div className="h-12 flex items-center justify-between px-3 bg-white border-b border-gray-200 flex-shrink-0">
        <div className="flex items-center gap-1.5 min-w-0">
          <FileText size={14} className="text-gray-400 flex-shrink-0" />
          <span className="text-sm text-gray-700 truncate max-w-[260px]">
            {documentName ?? 'Document'}
          </span>
        </div>

        {/* Zoom controls intentionally removed — re-rendering at a
            different scale caused a layout/render feedback loop
            (containerWidth ↔ Page width ↔ ResizeObserver) that
            flickered the column on every zoom step. The page is
            already auto-fit to the column via <Page width=...>, so
            users get a "100%" fit by default. */}
        <div className="flex items-center gap-1">
          <button
            onClick={handleRotate}
            className="rounded-md p-1.5 hover:bg-gray-100 transition-colors"
            title="Rotate"
            aria-label="Rotate"
          >
            <RotateCw size={16} className="text-gray-600" />
          </button>
          <span className="text-sm text-gray-600 font-mono ml-2">
            {currentPage} / {numPages || '–'}
          </span>
        </div>
      </div>

      {/* PDF display area. overflow-auto (not just overflow-y-auto) so
          the user can scroll horizontally inside the reader when they
          zoom the PDF in past 100% via the toolbar. At scale=1.0 the
          page fits exactly and no horizontal scrollbar appears. */}
      <div ref={scrollContainerRef} className="flex-1 bg-gray-100 overflow-auto">
        {isLoading && (
          <div className="flex items-center justify-center h-full">
            <Loader2 size={32} className="text-blue-600 animate-spin" />
          </div>
        )}

        {loadError && (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <AlertCircle size={32} className="text-red-500 mb-3" />
            <p className="text-sm text-gray-700">Could not load PDF.</p>
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
                  data-replay-pdf-page={pageNum}
                  className={`mx-auto max-w-full transition-shadow ${
                    checkedPages?.has(pageNum) ? 'ring-2 ring-amber-400 rounded' : ''
                  }`}
                >
                  {/* Per-page highlight checkbox bar sits above the page */}
                  {onPageChecked && (
                    <label
                      className={`flex items-center gap-1.5 px-2 py-1 text-[11px] cursor-pointer select-none border-b rounded-t ${
                        checkedPages?.has(pageNum)
                          ? 'bg-amber-100 border-amber-400 text-amber-800 font-semibold'
                          : 'bg-gray-50 border-gray-200 text-gray-500 hover:bg-amber-50 hover:text-amber-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={checkedPages?.has(pageNum) ?? false}
                        onChange={(e) => {
                          const pageEl = pageRefs.current.get(pageNum);
                          const text =
                            pageEl
                              ?.querySelector('.textLayer')
                              ?.textContent?.replace(/\s+/g, ' ')
                              .trim() ?? '';
                          onPageChecked(pageNum, e.target.checked, text);
                        }}
                        className="h-3 w-3 rounded border-gray-300 text-amber-600 focus:ring-amber-500 cursor-pointer"
                      />
                      <span>Slide {pageNum} — highlight for learning strategies</span>
                    </label>
                  )}
                  <div className="bg-white shadow-md rounded-b">
                    {containerWidth > 0 && (
                      <Page
                        pageNumber={pageNum}
                        width={containerWidth * scale}
                        rotate={rotation}
                        renderTextLayer={true}
                        renderAnnotationLayer={true}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>
          </Document>
        )}
      </div>
    </div>
  );
}

export default PdfReader;
