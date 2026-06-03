// Per-region rectangle captured alongside a DOM snapshot. Coordinates
// are viewport-relative pixels (left, top, width, height). The region
// string is the value of `data-replay-region` on the source element
// (e.g. "sidebar", "lesson", "pdf-viewer", "chatbot").
export interface ReplayAoiRect {
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Per-snapshot inner-scroll-host state. The docked course-view layout
// scrolls inside `overflow-y-auto` columns rather than the window, so
// window.scrollY/scrollX is a dead signal there — the replay needs
// the per-host scroll position to restore reading state. `region` is
// the value of `data-replay-region` on the nearest ancestor when
// the host is itself one of the four panels (sidebar / lesson /
// pdf-viewer / chatbot); `selector` is a best-effort CSS path used
// to re-locate the host inside the iframe when no region anchor is
// available. `scrollTopPercent` is precomputed against
// (scrollHeight - clientHeight) for direct CSV use.
export interface ReplayScrollHost {
  region: string | null;
  selector: string | null;
  scrollTop: number;
  scrollLeft: number;
  scrollHeight: number;
  scrollWidth: number;
  clientHeight: number;
  clientWidth: number;
  scrollTopPercent: number;
}

export interface ReplaySnapshotEventDto {
  pageUrl: string;
  html: string;
  screenshotDataUrl?: string;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  capturedAt: number;
  trigger: string;
  // Optional. When the recorder can't enumerate AOIs (no marked
  // regions on screen, getBoundingClientRect throws, etc.) the field
  // is simply omitted — the row's `aois` column stays NULL.
  aois?: ReplayAoiRect[];
  // Optional. Same omission contract as `aois` — capture failure
  // never blocks a snapshot.
  scrollHosts?: ReplayScrollHost[];
  // PDF reader semantic anchors. Present only when a PdfReader was
  // mounted at capture time; omitted otherwise. `pdfCurrentPage` is
  // 1-based to match the reader's UI.
  pdfCurrentPage?: number;
  pdfTotalPages?: number;
}

export interface CreateReplaySnapshotBatchDto {
  sessionId: string;
  userId: string;
  events: ReplaySnapshotEventDto[];
}
