import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { apiFetch, api } from '../../lib/api';
import { useToast } from '../../components/Toast';
import { usePageContext } from '../../contexts/PageContext';
import { useActivityLog } from '../../lib/activity-log';
import BlockRenderer from '../../components/editor/BlockRenderer';
import PdfReader from '../../components/PdfReader';
import { DockedChatbot } from '../../components/FloatingChatbot';

interface ModuleItem {
  id: string;
  type: 'PAGE' | 'PDF' | 'LINK' | 'ASSESSMENT';
  title: string;
  orderIndex: number;
  contentMdx: string | null;
  pdfBlobKey: string | null;
  pdfFilename: string | null;
  pdfSize: number | null;
  url: string | null;
  assessmentId: string | null;
}

interface CourseModule {
  id: string;
  title: string;
  orderIndex: number;
  items: ModuleItem[];
}

interface Course {
  id: string;
  title: string;
  description: string;
  status: string;
  learningMode?: string;
  teacher: { id: string; name: string };
  modules: CourseModule[];
}

// Docked-chatbot resizer constants. Width persists in localStorage so
// the student's preferred panel size survives reloads.
const CHATBOT_WIDTH_STORAGE_KEY = 'student-docked-chatbot-width';
const CHATBOT_MIN_WIDTH = 280;
const CHATBOT_MAX_WIDTH = 700;
const CHATBOT_DEFAULT_WIDTH = 400;
// Space we always reserve for the rest of the 3-column row when sizing
// the chatbot column: 256 (sidebar w-64) + 48 (two gap-6) + 4 (divider)
// + 280 (minimum readable content). When the viewport gets narrower
// than this + chatbot min, the chatbot is squeezed below its preferred
// width so the layout still fits without horizontal scroll.
const CHATBOT_LAYOUT_RESERVE = 588;

function loadChatbotWidth(): number {
  try {
    const raw = localStorage.getItem(CHATBOT_WIDTH_STORAGE_KEY);
    if (!raw) return CHATBOT_DEFAULT_WIDTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return CHATBOT_DEFAULT_WIDTH;
    return Math.min(Math.max(n, CHATBOT_MIN_WIDTH), CHATBOT_MAX_WIDTH);
  } catch {
    return CHATBOT_DEFAULT_WIDTH;
  }
}

// Sidebar (module list) resizer + collapse. Width persists separately
// from the chatbot column so each is independently restorable. The
// inline `style.width` (not a Tailwind class) is what the AOI capture
// pipeline picks up via getBoundingClientRect — drag → new width every
// snapshot, collapse → zero-area rect (display:none).
const SIDEBAR_WIDTH_STORAGE_KEY = 'gals.studentCourseView.sidebarWidth';
const SIDEBAR_COLLAPSED_STORAGE_KEY = 'gals.studentCourseView.sidebarCollapsed';
const SIDEBAR_MIN_WIDTH = 180;
const SIDEBAR_MAX_WIDTH = 480;
const SIDEBAR_DEFAULT_WIDTH = 256; // matches the old `w-64` Tailwind class

function loadSidebarWidth(): number {
  try {
    const raw = localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY);
    if (!raw) return SIDEBAR_DEFAULT_WIDTH;
    const n = Number(raw);
    if (!Number.isFinite(n)) return SIDEBAR_DEFAULT_WIDTH;
    return Math.min(Math.max(n, SIDEBAR_MIN_WIDTH), SIDEBAR_MAX_WIDTH);
  } catch {
    // localStorage can throw in private-browsing modes / sandboxed
    // iframes. Silently fall back to the default.
    return SIDEBAR_DEFAULT_WIDTH;
  }
}

function loadSidebarCollapsed(): boolean {
  try {
    return localStorage.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

export function StudentCourseViewPage() {
  const { courseId } = useParams<{ courseId: string }>();
  const navigate = useNavigate();
  const { toast } = useToast();

  const {
    setPageContext,
    setPdfNumPages,
    setPdfCurrentPageText,
    setSelectedText,
    clearSelectedText,
  } = usePageContext();
  const { track } = useActivityLog();
  const [course, setCourse] = useState<Course | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  // Per-page highlight checkbox state. Tracks which PDF pages (if any) are
  // currently checked so PdfReader can render the right checkbox state.
  const [checkedPdfPages, setCheckedPdfPages] = useState<Set<number>>(new Set());
  const checkedPdfPagesTextRef = useRef<Map<number, string>>(new Map());
  const [vlmConfig, setVlmConfig] = useState<{
    enabled: boolean;
    textThreshold: number;
    imageWidth: number;
    imageHeight: number;
  } | null>(null);

  // Clear the per-page checkboxes when the student switches to a different item.
  useEffect(() => {
    setCheckedPdfPages(new Set());
    checkedPdfPagesTextRef.current = new Map();
    clearSelectedText();
  }, [selectedItemId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePageChecked = useCallback(
    (pageNum: number, checked: boolean, pageText: string) => {
      if (checked) checkedPdfPagesTextRef.current.set(pageNum, pageText);
      else checkedPdfPagesTextRef.current.delete(pageNum);
      setCheckedPdfPages((prev) => {
        const next = new Set(prev);
        if (checked) next.add(pageNum);
        else next.delete(pageNum);
        return next;
      });
      // Combine text from all checked pages in page order
      const combined = [...checkedPdfPagesTextRef.current.entries()]
        .sort(([a], [b]) => a - b)
        .map(([, t]) => t)
        .filter(Boolean)
        .join('\n\n---\n\n');
      if (combined.length > 10) setSelectedText(combined);
      else clearSelectedText();
    },
    [setSelectedText, clearSelectedText],
  );

  // Stable callback for PdfReader.onPdfMeta. Without useCallback we
  // emit a new lambda every render — combined with PdfReader putting
  // the callback in a useEffect dep array, that produced an infinite
  // render loop visible as flicker during PDF zoom. PdfReader now
  // also guards via a ref, but keeping this stable is cheap insurance
  // and makes the data flow easier to reason about.
  const handlePdfMeta = useCallback(
    ({ numPages }: { currentPage: number; numPages: number }) => {
      setPdfNumPages(numPages);
    },
    [setPdfNumPages],
  );
  // Per-item presigned PDF URL cache. Keyed by module item id.
  const [pdfUrls, setPdfUrls] = useState<Record<string, string>>({});
  const [pdfLoadingId, setPdfLoadingId] = useState<string | null>(null);

  // ─── Docked chatbot resizer ──────────────────────────────
  // The chatbot sits to the right of the content area. The student can
  // drag the divider between them to give themselves more or less
  // reading room.
  //
  // Two values, distinct on purpose:
  //   - `preferredChatbotWidth`: what the user dragged to. Persisted.
  //     This is their *intent* — we restore it whenever the viewport
  //     has room.
  //   - `rowWidth`: current measured width of the 3-column row. Drives
  //     the upper bound on displayed chatbot width so the layout never
  //     overflows the viewport at high browser zoom.
  //
  // Displayed width = clamp(preferred, MIN, rowWidth - reserve).
  // When the user zooms in (viewport shrinks), the chatbot squeezes;
  // when they zoom back out it pops back to their preferred size.
  const [preferredChatbotWidth, setPreferredChatbotWidth] = useState<number>(() =>
    loadChatbotWidth(),
  );
  const [rowWidth, setRowWidth] = useState<number>(() =>
    typeof window !== 'undefined' ? window.innerWidth : 1280,
  );
  const rowRef = useRef<HTMLDivElement>(null);
  const isResizingChatbot = useRef(false);
  const resizeStart = useRef({ mouseX: 0, startWidth: 0 });

  // The effective max the chatbot is allowed to occupy right now. Never
  // less than the chatbot's own minimum — at extreme zoom levels we let
  // overflow-hidden on the row clip rather than collapse below
  // usability.
  const maxAllowedChatbotWidth = Math.max(
    CHATBOT_MIN_WIDTH,
    Math.min(CHATBOT_MAX_WIDTH, rowWidth - CHATBOT_LAYOUT_RESERVE),
  );
  const displayedChatbotWidth = Math.min(preferredChatbotWidth, maxAllowedChatbotWidth);

  // Observe the row's actual rendered width (preferred over
  // window.innerWidth because the row itself sits inside the global
  // Layout's main column, not the full viewport). Fires on browser zoom,
  // window resize, devtools toggling, etc.
  useEffect(() => {
    const el = rowRef.current;
    if (!el) return;
    const update = () => {
      const w = el.clientWidth;
      if (w > 0) setRowWidth(w);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent) => {
      isResizingChatbot.current = true;
      resizeStart.current = { mouseX: e.clientX, startWidth: displayedChatbotWidth };
      e.preventDefault();
    },
    [displayedChatbotWidth],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isResizingChatbot.current) return;
      // Drag-left grows the panel, drag-right shrinks it (the panel
      // sits on the right; moving the divider right takes width away).
      const dx = resizeStart.current.mouseX - e.clientX;
      const next = Math.min(
        Math.max(resizeStart.current.startWidth + dx, CHATBOT_MIN_WIDTH),
        CHATBOT_MAX_WIDTH,
      );
      setPreferredChatbotWidth(next);
    };
    const handleUp = () => {
      if (!isResizingChatbot.current) return;
      isResizingChatbot.current = false;
      // Persist what the user actually wanted, not the (possibly
      // viewport-clamped) displayed value — so when they later zoom
      // back out we restore their intended size.
      try {
        localStorage.setItem(CHATBOT_WIDTH_STORAGE_KEY, String(preferredChatbotWidth));
      } catch {
        // ignore storage errors
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [preferredChatbotWidth]);

  // ─── Sidebar (module list) resizer + collapse ────────────
  // Same MouseDown/MouseMove pattern as the chatbot resizer above.
  // The drag handle sits on the RIGHT edge of the sidebar so dragging
  // right grows it, dragging left shrinks it. Width persists across
  // reloads under SIDEBAR_WIDTH_STORAGE_KEY; collapsed state under
  // SIDEBAR_COLLAPSED_STORAGE_KEY.
  //
  // AOI capture contract (see useSessionReplayRecorder.captureAois):
  //   - On drag, the inline `style.width` updates → next snapshot's
  //     getBoundingClientRect() returns the new width.
  //   - On collapse, the wrapper gets `display: none` → next snapshot's
  //     bounding rect is {0,0,0,0} → recorded as a zero-area entry
  //     (post-capture-fix, the recorder includes tagged regions even
  //     when their rect is empty so the CSV's aoi_sidebar_w/h flip to 0).
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => loadSidebarWidth());
  const [sidebarCollapsed, setSidebarCollapsed] = useState<boolean>(() => loadSidebarCollapsed());
  const isResizingSidebar = useRef(false);
  const sidebarResizeStart = useRef({ mouseX: 0, startWidth: 0 });

  const handleSidebarResizeStart = useCallback(
    (e: React.MouseEvent) => {
      // Guard: a drag started on a hidden handle (shouldn't be hittable
      // anyway since we don't render it when collapsed) is a no-op.
      if (sidebarCollapsed) return;
      isResizingSidebar.current = true;
      sidebarResizeStart.current = { mouseX: e.clientX, startWidth: sidebarWidth };
      e.preventDefault();
    },
    [sidebarCollapsed, sidebarWidth],
  );

  useEffect(() => {
    const handleMove = (e: MouseEvent) => {
      if (!isResizingSidebar.current) return;
      // Drag-right grows the panel (handle is on the right edge of
      // the sidebar; moving it right takes width from the lesson
      // column and gives it to the sidebar).
      const dx = e.clientX - sidebarResizeStart.current.mouseX;
      const next = Math.min(
        Math.max(sidebarResizeStart.current.startWidth + dx, SIDEBAR_MIN_WIDTH),
        SIDEBAR_MAX_WIDTH,
      );
      setSidebarWidth(next);
    };
    const handleUp = () => {
      if (!isResizingSidebar.current) return;
      isResizingSidebar.current = false;
      try {
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
      } catch {
        // ignore storage errors
      }
    };
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };
  }, [sidebarWidth]);

  const toggleSidebarCollapsed = useCallback(() => {
    setSidebarCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(SIDEBAR_COLLAPSED_STORAGE_KEY, next ? '1' : '0');
      } catch {
        // ignore storage errors
      }
      return next;
    });
  }, []);

  // Emit MODULE_OPENED activity event once per course load. Without these
  // events the teacher's replay timeline has no anchor for the session
  // and biometric/snapshot data appears disconnected from the lesson.
  useEffect(() => {
    if (!course) return;
    track('MODULE_OPENED', {
      courseId: course.id,
      metadata: {
        courseTitle: course.title,
        moduleCount: course.modules.length,
        mode: 'standard',
      },
    });
  }, [course?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Emit MODULE_ITEM_VIEWED whenever the student picks a different item
  // in the lesson sidebar. Keyed off selectedItemId so each item view is
  // its own event (lets the replay show the student's reading path).
  useEffect(() => {
    if (!course || !selectedItemId) return;
    const item = course.modules.flatMap((m) => m.items).find((i) => i.id === selectedItemId);
    if (!item) return;
    track('MODULE_ITEM_VIEWED', {
      courseId: course.id,
      moduleItemId: selectedItemId,
      metadata: {
        itemTitle: item.title,
        itemType: item.type,
        pdfFilename: item.pdfFilename ?? null,
      },
    });
  }, [selectedItemId, course?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  // Update page context when course or selected item changes
  useEffect(() => {
    if (course && selectedItemId) {
      const item = course.modules.flatMap((m) => m.items).find((i) => i.id === selectedItemId);
      // For PDF items the floating chatbot uses the filename as the "topic"
      // hint so that, when the student hasn't highlighted anything, the
      // backend can ground the intervention on this specific PDF.
      const isPdf = item?.type === 'PDF';
      setPageContext({
        pageType: 'lesson',
        courseId: course.id,
        contentId: selectedItemId,
        contentTitle: isPdf
          ? (item?.pdfFilename ?? item?.title ?? course.title)
          : (item?.title ?? course.title),
        contentText: item?.type === 'PAGE' && item.contentMdx ? item.contentMdx : null,
        sourceDocumentId: null,
      });
      if (isPdf && item?.pdfFilename) {
        api
          .get<{ documentId: string | null }>(
            `/pre-generation/match-document?courseId=${course.id}&filename=${encodeURIComponent(item.pdfFilename)}`,
          )
          .then(({ documentId }) => {
            if (documentId) setPageContext({ sourceDocumentId: documentId });
          })
          .catch(() => {});
      }
      // P3 — clear PDF numPages when switching off a PDF item so the
      // practice-testing config panel doesn't default to a stale
      // value from a previously-viewed PDF. The PdfReader's
      // onPdfMeta will re-set it once the next PDF loads.
      if (!isPdf) setPdfNumPages(null);
      if (!isPdf) setPdfCurrentPageText(null, null);
    } else if (course) {
      setPageContext({
        pageType: 'lesson',
        courseId: course.id,
        contentId: null,
        contentTitle: course.title,
        contentText: null,
        sourceDocumentId: null,
      });
      setPdfNumPages(null);
      setPdfCurrentPageText(null, null);
    }
  }, [course, selectedItemId, setPageContext, setPdfNumPages, setPdfCurrentPageText]);

  // Lazily fetch a presigned URL for the currently-selected PDF item so the
  // inline PdfReader can render it. Cache per-item so switching back doesn't
  // re-fetch. Presigned URLs typically last ~hours which is plenty for a
  // single reading session.
  useEffect(() => {
    if (!selectedItemId || !course) return;
    const item = course.modules.flatMap((m) => m.items).find((i) => i.id === selectedItemId);
    if (!item || item.type !== 'PDF' || !item.pdfBlobKey) return;
    if (pdfUrls[item.id]) return; // already cached
    let cancelled = false;
    setPdfLoadingId(item.id);
    (async () => {
      try {
        const { url } = await apiFetch<{ url: string; filename: string }>(
          `/items/${item.id}/download-url`,
        );
        if (!cancelled) {
          setPdfUrls((prev) => ({ ...prev, [item.id]: url }));
        }
      } catch (err) {
        if (!cancelled) {
          toast('error', err instanceof Error ? err.message : 'Failed to load PDF');
        }
      } finally {
        if (!cancelled) setPdfLoadingId(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedItemId, course, pdfUrls, toast]);

  useEffect(() => {
    const fetch = async () => {
      try {
        const data = await apiFetch<Course>(`/courses/${courseId}`);
        // Redirect dialogue courses to the dialogue learning interface
        if (data.learningMode === 'DIALOGUE') {
          navigate(`/student/courses/${courseId}/dialogue`, { replace: true });
          return;
        }
        setCourse(data);
        // Fetch teacher's VLM config so PdfReader knows whether to call VLM
        // for image-sparse slides and what resolution to resize to.
        api
          .get<{
            enabled: boolean;
            textThreshold: number;
            imageWidth: number;
            imageHeight: number;
          }>(`/vlm/config/course/${courseId}`)
          .then((cfg) => setVlmConfig(cfg))
          .catch(() => {});
        // Auto-select first item
        const firstItem = data.modules[0]?.items[0];
        if (firstItem) setSelectedItemId(firstItem.id);
      } catch {
        toast('error', 'Failed to load course');
        navigate('/student/courses');
      } finally {
        setLoading(false);
      }
    };
    fetch();
  }, [courseId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handlePdfDownload = async (itemId: string) => {
    try {
      const { url } = await apiFetch<{ url: string; filename: string }>(
        `/items/${itemId}/download-url`,
      );
      window.open(url, '_blank');
    } catch (err) {
      toast('error', err instanceof Error ? err.message : 'Failed to open PDF');
    }
  };

  if (loading || !course) return <div className="text-gray-500">Loading course...</div>;

  // Find selected item across all modules
  let selectedItem: ModuleItem | null = null;
  for (const mod of course.modules) {
    const found = mod.items.find((i) => i.id === selectedItemId);
    if (found) {
      selectedItem = found;
      break;
    }
  }

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-3 mb-6">
        <button
          onClick={() => navigate('/student/courses')}
          className="text-gray-500 hover:text-gray-700"
        >
          &larr; Back
        </button>
        <div>
          <h2 className="text-2xl font-bold text-gray-900">{course.title}</h2>
          <p className="text-sm text-gray-500">by {course.teacher.name}</p>
        </div>
      </div>

      {course.modules.length === 0 ? (
        <div className="text-gray-400 text-center py-12">This course has no content yet.</div>
      ) : (
        // Three-column layout: module sidebar | lesson content | docked
        // chatbot. The middle column is `flex-1` so it absorbs whatever
        // space the chatbot doesn't claim. The vertical divider between
        // content and chatbot is a drag handle (see handleResizeStart).
        // `items-stretch` (default) gives all three columns the same
        // height. `overflow-hidden` + a hard `height` lock the whole row
        // to the viewport — without this the chat input got pushed
        // below the fold whenever the lesson content was long, because
        // the row grew with the tallest child. Now each column scrolls
        // on its own inside the viewport-bounded row.
        <div
          ref={rowRef}
          className="flex gap-6 items-stretch overflow-hidden"
          style={{ height: 'calc(100vh - 200px)' }}
        >
          {/* Sidebar: Module/Item navigation. overflow-y-auto so long
              module lists scroll inside the column instead of pushing
              the chatbot down. pr-1 leaves a hair of room for the
              scrollbar so it doesn't crowd the buttons.
              data-replay-region is what the replay recorder reads via
              getBoundingClientRect() to log AOI rectangles for
              gaze-coverage analysis. Purely metadata — no runtime
              effect on layout or styling.
              Width + display are inline styles (not Tailwind classes)
              because they're dynamic: drag-resize updates `width`, and
              collapse sets `display: none` so getBoundingClientRect()
              returns {0,0,0,0} which the AOI pipeline interprets as
              "panel hidden at this moment". */}
          <div
            data-replay-region="sidebar"
            className="shrink-0 overflow-y-auto pr-1 relative"
            style={
              sidebarCollapsed ? { width: 0, display: 'none' } : { width: `${sidebarWidth}px` }
            }
          >
            {/* Collapse toggle pinned to the sidebar's top-right corner.
                sticky so it stays in view when the module list scrolls. */}
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className="sticky top-0 z-10 ml-auto flex h-6 w-6 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              title="Collapse module list"
              aria-label="Collapse module list"
            >
              <ChevronLeft size={14} />
            </button>
            {course.modules.map((mod) => (
              <div key={mod.id} className="mb-4">
                <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1">
                  {mod.title}
                </h4>
                <div className="space-y-0.5">
                  {mod.items.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => setSelectedItemId(item.id)}
                      className={`w-full text-left px-3 py-2 text-sm rounded-lg transition-colors flex items-center gap-2 ${
                        selectedItemId === item.id
                          ? 'bg-blue-50 text-blue-700 font-medium'
                          : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <span
                        className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          item.type === 'PAGE'
                            ? 'bg-blue-400'
                            : item.type === 'PDF'
                              ? 'bg-red-400'
                              : item.type === 'LINK'
                                ? 'bg-purple-400'
                                : 'bg-green-400'
                        }`}
                      />
                      <span className="truncate">{item.title}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>

          {/* Sidebar resize handle. Mirrors the chatbot divider on the
              right side of the row. Hidden while collapsed (the expand
              tab below takes its role). 4px hit area, 1px visible. */}
          {!sidebarCollapsed && (
            <div
              onMouseDown={handleSidebarResizeStart}
              className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors"
              title="Drag to resize module list"
            />
          )}

          {/* Expand tab — shown only when the sidebar is collapsed.
              Sits on the lesson column's left edge as a small clickable
              chevron. Not tagged with data-replay-region so it doesn't
              show up as a separate AOI; gaze on this button counts as
              "lesson" (it's visually part of the lesson column). */}
          {sidebarCollapsed && (
            <button
              type="button"
              onClick={toggleSidebarCollapsed}
              className="flex h-12 w-5 shrink-0 items-center justify-center self-start rounded-r border border-l-0 border-gray-200 bg-white text-gray-400 hover:bg-gray-50 hover:text-gray-700"
              title="Expand module list"
              aria-label="Expand module list"
            >
              <ChevronRight size={14} />
            </button>
          )}

          {/* Content area. data-selectable scopes the global selection
              listener to this region so the chatbot only ever picks up
              selections from inside the lesson, not from navbar / sidebar.

              The outer container is `overflow-hidden flex flex-col` with
              no padding so the inner wrappers can control scroll
              independently — padding inside lets the scrollbar hug the
              border, not the text. PDF gets a flex-1 layout so PdfReader
              can fill remaining space; the other variants scroll on
              their own. */}
          <div
            data-selectable="true"
            data-replay-region="lesson"
            className="flex-1 min-w-0 bg-white rounded-lg border border-gray-200 overflow-hidden flex flex-col"
          >
            {!selectedItem ? (
              <div className="p-6 flex-1 min-h-0 overflow-y-auto">
                <p className="text-gray-400">Select an item from the left.</p>
              </div>
            ) : selectedItem.type === 'PAGE' ? (
              <div className="p-6 flex-1 min-h-0 overflow-y-auto">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{selectedItem.title}</h3>
                {selectedItem.contentMdx ? (
                  <BlockRenderer content={selectedItem.contentMdx} />
                ) : (
                  <p className="text-gray-400">No content yet.</p>
                )}
              </div>
            ) : selectedItem.type === 'PDF' ? (
              // PDF needs a flex-column inside the column so PdfReader
              // can take `flex-1 min-h-0` and fill the column. No
              // explicit pixel height — the parent already bounds us.
              <div className="p-6 flex-1 min-h-0 flex flex-col">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-lg font-semibold text-gray-900">{selectedItem.title}</h3>
                  <button
                    onClick={() => handlePdfDownload(selectedItem!.id)}
                    className="text-xs text-gray-500 hover:text-gray-700 underline"
                  >
                    Open in new tab
                  </button>
                </div>
                {!selectedItem.pdfBlobKey ? (
                  <p className="text-gray-400">PDF not yet uploaded.</p>
                ) : pdfUrls[selectedItem.id] ? (
                  <div
                    data-replay-region="pdf-viewer"
                    className="flex-1 min-h-0 border border-gray-200 rounded-lg overflow-hidden"
                  >
                    <PdfReader
                      documentUrl={pdfUrls[selectedItem.id]!}
                      documentName={selectedItem.pdfFilename ?? selectedItem.title}
                      onTextSelected={(text) => {
                        // Drag-selection overrides checkbox selection
                        setSelectedText(text);
                        setCheckedPdfPages(new Set());
                        checkedPdfPagesTextRef.current = new Map();
                      }}
                      onSelectionCleared={() => {
                        // mousedown fires this on every click inside the PDF,
                        // including checkbox clicks — only clear when no pages
                        // are checkbox-selected, otherwise preserve combined text.
                        if (checkedPdfPages.size === 0) clearSelectedText();
                      }}
                      onPdfMeta={handlePdfMeta}
                      onCurrentPageText={({ pageNumber, text }) =>
                        setPdfCurrentPageText(pageNumber, text)
                      }
                      checkedPages={checkedPdfPages}
                      onPageChecked={handlePageChecked}
                      courseId={courseId}
                      vlmConfig={vlmConfig}
                    />
                  </div>
                ) : (
                  <p className="text-sm text-gray-400">
                    {pdfLoadingId === selectedItem.id ? 'Loading PDF…' : 'Preparing PDF…'}
                  </p>
                )}
                <p className="mt-2 text-xs text-gray-400 shrink-0">
                  Highlight text in the PDF to use it with the chatbot, or open the chatbot without
                  a selection to ground on this PDF's content.
                </p>
              </div>
            ) : selectedItem.type === 'LINK' ? (
              <div className="p-6 flex-1 min-h-0 overflow-y-auto">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{selectedItem.title}</h3>
                {selectedItem.url ? (
                  <a
                    href={selectedItem.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline break-all"
                  >
                    {selectedItem.url}
                  </a>
                ) : (
                  <p className="text-gray-400">No URL set.</p>
                )}
              </div>
            ) : (
              <div className="p-6 flex-1 min-h-0 overflow-y-auto">
                <h3 className="text-lg font-semibold text-gray-900 mb-4">{selectedItem.title}</h3>
                <p className="text-sm text-gray-500">
                  This is a linked assessment. Go to{' '}
                  <button
                    onClick={() => navigate('/student/assessments')}
                    className="text-blue-600 hover:underline"
                  >
                    Assessments
                  </button>{' '}
                  to take it.
                </p>
              </div>
            )}
          </div>

          {/* Vertical drag handle between content and chatbot. 4px hit
              area but we render a 1px visible line so it doesn't look
              chunky. cursor-col-resize gives the right affordance. */}
          <div
            onMouseDown={handleResizeStart}
            className="w-1 shrink-0 cursor-col-resize bg-gray-200 hover:bg-blue-400 transition-colors"
            title="Drag to resize chat panel"
          />

          {/* Docked chatbot — same ChatbotPanel the floating wrapper
              uses, so logging, persistence, and intervention strategies
              all behave identically. Width follows the resizer (with
              viewport-aware clamping via displayedChatbotWidth) so the
              column reflows under browser zoom rather than overflowing
              horizontally. shrink-0 prevents flex from squashing it
              below the set width. */}
          <div
            data-replay-region="chatbot"
            className="shrink-0"
            style={{ width: displayedChatbotWidth }}
          >
            <DockedChatbot
              onClearAllHighlights={() => {
                setCheckedPdfPages(new Set());
                checkedPdfPagesTextRef.current = new Map();
              }}
            />
          </div>
        </div>
      )}
    </div>
  );
}
