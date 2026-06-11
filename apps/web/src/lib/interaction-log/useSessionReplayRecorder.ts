import { useCallback, useEffect, useRef } from 'react';
import { api } from '../api';
import { peekPermittedScreenStream } from '../biometrics/permittedStreams';

const API_BASE = '/api';
const FLUSH_INTERVAL_MS = 10_000;
const PERIODIC_SNAPSHOT_MS = 3_000;
// Per-snapshot HTML cap. The previous 250k was hit hard by PDF lessons:
// react-pdf renders every character of every page as a positioned
// <span> for selectable text, and a single PDF page can easily push
// the serialized DOM past 250k. When truncation fired, the LAST
// children of the document — including the docked chatbot column on
// /student/courses/:courseId — got chopped, so the replay's iframe
// showed the lesson without the chatbot.
//
// Raised in stages:
//   250 KB → 2 MB (raw DOM coverage for PDF spans)
//   2 MB → 5 MB (after adding canvas-pixel inlining for PDF replay —
//                see `inlineCanvasPixels`. Canvas data URLs alone can
//                run 200-400 KB per page; ~10 visible pages + the
//                base DOM was crossing 2 MB and re-truncating the
//                trailing chatbot column. The 5 MB ceiling + the
//                tighter canvas budget below leaves ~2 MB headroom
//                for the rest of the DOM before truncation can
//                affect the chatbot.)
//
// API body limit is 12 MB (apps/api/src/main.ts), so even at the new
// 5 MB cap plus a screenshot data URL we sit comfortably under it.
const MAX_HTML_CHARS = 5_000_000;
// Per-batch HTTP body limit. Bumped in lockstep with MAX_HTML_CHARS
// so a single oversized snapshot still fits in one batch (the
// `splitIntoSizedChunks` helper puts oversized events in their own
// chunk, but the batch still has to be acceptably sized).
const MAX_BATCH_BYTES = 8_000_000;

interface UseSessionReplayRecorderParams {
  sessionId: string;
  userId: string;
  enabled?: boolean;
  /**
   * Whether to capture and store the full serialised DOM (html) with each
   * snapshot. DOM capture produces very large payloads (~500 KB–5 MB per
   * snapshot) and drives the majority of database storage growth.
   *
   * Defaults to false. Enable only when DOM-based session replay is
   * required for research — pixel screenshots are always captured regardless.
   */
  captureDom?: boolean;
}

interface ReplayAoiRect {
  region: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

// Per-snapshot inner-scroll-host state. window.scrollY is a dead
// signal in the docked course-view layout — both the lesson MDX and
// the PDF reader scroll inside inner `overflow-y-auto` containers,
// not the window. This payload lets the replay (and the CSV export)
// know where every overflowing element actually is at capture time.
//
// Coordinate contract (see also captureAois doc): coordinates here are
// IN-HOST scroll offsets, NOT viewport pixels — `scrollTop` is the
// number of pixels the host has been scrolled inside its own content
// box, which is independent of where the host sits in the viewport
// (that's `aois` territory). Both are needed for the replay to
// reconstruct what the student was actually looking at.
interface ReplayScrollHost {
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

interface ReplaySnapshotPayload {
  pageUrl: string;
  /** Omitted when captureDom=false (pixel-only mode). */
  html?: string;
  screenshotDataUrl?: string;
  width: number;
  height: number;
  // window-level scroll. Almost always 0 in the docked layout
  // (the lesson + PDF scroll inside inner containers — see
  // `scrollHosts` below) but preserved for pages whose body actually
  // scrolls the window (dashboards, catalog, dialogue mode).
  scrollX: number;
  scrollY: number;
  capturedAt: number;
  trigger: string;
  // ─── AOI / scroll / PDF coordinate contract ─────────────
  // Three distinct coordinate spaces in this payload:
  //   1. `aois[].x/y/width/height` — viewport-relative PIXELS,
  //      top-left origin (matches DOMRect / clientX-clientY). One
  //      entry per [data-replay-region] element with a non-zero rect
  //      at capture time. Sized in CSS px, NOT scaled by devicePixel-
  //      Ratio. Used by the replay overlay and the AOI scoring kernel.
  //   2. `scrollHosts[].scrollTop / scrollLeft / scrollHeight /
  //      scrollWidth / clientHeight / clientWidth` — IN-HOST CSS pixel
  //      offsets, INDEPENDENT of the host's viewport position. A panel
  //      can sit at viewport y=80 (aois entry) AND have scrollTop=1248
  //      (scrollHosts entry) — both are needed.
  //   3. `pdfCurrentPage / pdfTotalPages` — semantic anchor (1-based
  //      page number) read from the PdfReader component's
  //      `data-replay-pdf-current-page` attribute. Used as a fallback
  //      restore target when the iframe's scroll-host content height
  //      isn't yet final (canvas-replacement <img>s may still be
  //      decoding when iframe.onload fires).
  //
  // All four are optional. The recorder is best-effort and
  // triple-defensively guarded — any throw in capture path drops the
  // field but never blocks the snapshot insert. The backend coerces
  // non-array JSON fields to Prisma.JsonNull (see logs.service.ts).
  aois?: ReplayAoiRect[];
  scrollHosts?: ReplayScrollHost[];
  pdfCurrentPage?: number;
  pdfTotalPages?: number;
}

/**
 * Best-effort enumeration of AOI rectangles. Reads every
 * `[data-replay-region]` element currently in the live DOM and
 * captures its viewport-relative bounding rect plus the region label.
 *
 * Zero-area rects (width === 0 OR height === 0) ARE recorded for
 * tagged regions — they're the "panel hidden at this moment" signal.
 * The student can drag-collapse the module-list sidebar (display:none
 * → bounding rect {0,0,0,0}); downstream consumers need to see the
 * region key present with w=0,h=0 in that snapshot so the CSV's
 * per-panel `aoi_sidebar_w` row flips from a positive number to 0
 * (NOT to null, which is what the carry-forward emits when the region
 * is missing entirely and means "the panel isn't on screen anymore").
 * Hit-testers (`pickBucketForGaze`, `aoiCoverage` in ReplayTab) use
 * strict half-open intervals — `gazeX < r.x + r.width` is unreachable
 * when `r.width === 0` — so a zero-area rect can never claim a gaze
 * sample, and the AOI overlay renders it with 0 px width/height
 * (visually invisible).
 *
 * Wrapped in try/catch and per-element try/catch so a single broken
 * element (detached node mid-frame, unusual CSS, throwing custom
 * element) can never block the snapshot from being recorded. Returns
 * `undefined` rather than `[]` when capture fails outright, so the
 * server omits the column instead of writing an empty array.
 */
function captureAois(): ReplayAoiRect[] | undefined {
  try {
    const nodes = document.querySelectorAll<HTMLElement>('[data-replay-region]');
    if (nodes.length === 0) return undefined;
    const rects: ReplayAoiRect[] = [];
    nodes.forEach((node) => {
      try {
        const region = node.getAttribute('data-replay-region');
        if (!region) return;
        const r = node.getBoundingClientRect();
        // Clamp negatives (a region scrolled above the viewport top
        // can report negative width/height in some edge cases) but
        // PRESERVE zero — see header comment for the hidden-panel
        // contract.
        const width = r.width > 0 ? Math.round(r.width) : 0;
        const height = r.height > 0 ? Math.round(r.height) : 0;
        rects.push({
          region,
          x: Math.round(r.left),
          y: Math.round(r.top),
          width,
          height,
        });
      } catch {
        // Per-element failure — ignore this one and keep going.
      }
    });
    return rects.length > 0 ? rects : undefined;
  } catch {
    return undefined;
  }
}

function sendKeepalive(body: object) {
  try {
    const token = localStorage.getItem('token');
    fetch(`${API_BASE}/logs/replay-snapshots`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify(body),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Ignore unload failures
  }
}

function splitIntoSizedChunks(
  sessionId: string,
  userId: string,
  events: ReplaySnapshotPayload[],
): ReplaySnapshotPayload[][] {
  const chunks: ReplaySnapshotPayload[][] = [];
  let currentChunk: ReplaySnapshotPayload[] = [];

  for (const event of events) {
    const candidateChunk = [...currentChunk, event];
    const candidateSize = JSON.stringify({
      sessionId,
      userId,
      events: candidateChunk,
    }).length;

    if (currentChunk.length > 0 && candidateSize > MAX_BATCH_BYTES) {
      chunks.push(currentChunk);
      currentChunk = [event];
    } else {
      currentChunk = candidateChunk;
    }
  }

  if (currentChunk.length > 0) {
    chunks.push(currentChunk);
  }

  return chunks;
}

function syncInputState(sourceRoot: ParentNode, cloneRoot: ParentNode) {
  const inputs = Array.from(sourceRoot.querySelectorAll('input'));
  const cloneInputs = Array.from(cloneRoot.querySelectorAll('input'));
  inputs.forEach((input, index) => {
    const clone = cloneInputs[index];
    if (!clone) return;

    if (input.type === 'password' || input.autocomplete.includes('password')) {
      clone.setAttribute('value', '[REDACTED]');
    } else if (input.type !== 'file') {
      clone.setAttribute('value', input.value);
    } else {
      clone.removeAttribute('value');
      clone.setAttribute('data-selected-files', String(input.files?.length ?? 0));
    }

    if (input.checked) clone.setAttribute('checked', 'checked');
    else clone.removeAttribute('checked');
  });

  const textareas = Array.from(sourceRoot.querySelectorAll('textarea'));
  const cloneTextareas = Array.from(cloneRoot.querySelectorAll('textarea'));
  textareas.forEach((textarea, index) => {
    const clone = cloneTextareas[index];
    if (!clone) return;
    clone.textContent = textarea.value;
  });

  const selects = Array.from(sourceRoot.querySelectorAll('select'));
  const cloneSelects = Array.from(cloneRoot.querySelectorAll('select'));
  selects.forEach((select, index) => {
    const clone = cloneSelects[index];
    if (!clone) return;
    Array.from(clone.options).forEach((option, optionIndex) => {
      option.selected = select.options[optionIndex]?.selected ?? false;
    });
  });
}

/**
 * Inline rendered pixels for every `<canvas>` in the cloned document.
 *
 * react-pdf (and chart / whiteboard widgets) draw to canvas. Canvas
 * pixels are NOT part of `outerHTML`, so a vanilla `cloneNode` /
 * serialize round-trip emits an empty canvas element and the replay
 * shows blank where the PDF used to be.
 *
 * Strategy: walk every canvas in the live document, read its rendered
 * pixels via `toDataURL('image/jpeg', quality)`, and replace the
 * corresponding canvas in the clone with an `<img>` sized to the
 * original. Canvases inside `[data-replay-region="pdf-viewer"]` get
 * higher JPEG quality so PDF text stays legible at replay zoom; other
 * canvases (small charts, decorative widgets) get a smaller quality to
 * keep the snapshot payload bounded.
 *
 * Cross-origin / tainted canvas: `toDataURL` throws `SecurityError`.
 * On failure we leave the cloned canvas untouched and continue — the
 * pixel-screenshot path picks up the slack at replay time. Per the
 * invariant, capture failure never blocks a snapshot.
 *
 * Total inlined-bytes are capped at ~6 MB so a 200-page PDF can't
 * blow past the API body limit (12 MB) on its own. Excess canvases
 * are skipped (logged once per snapshot) — they fall back to blank in
 * replay, same as before this fix.
 */
const PDF_CANVAS_JPEG_QUALITY = 0.75;
const OTHER_CANVAS_JPEG_QUALITY = 0.55;
// Budget for inlined canvas pixel data per snapshot. Must leave room
// for the rest of the DOM under MAX_HTML_CHARS, otherwise the
// trailing chatbot column gets truncated mid-session — that was the
// regression that made the chatbot disappear as the student scrolled
// through PDF pages.
//
// 2.5 MB canvas + ~1-2 MB base DOM = comfortably under the 5 MB
// MAX_HTML_CHARS cap, with room for the screenshot data URL.
const MAX_CANVAS_PIXEL_BYTES = 2_500_000;

function inlineCanvasPixels(clone: HTMLHtmlElement): void {
  let liveCanvases: HTMLCanvasElement[];
  let cloneCanvases: HTMLCanvasElement[];
  try {
    liveCanvases = Array.from(document.querySelectorAll('canvas'));
    cloneCanvases = Array.from(clone.querySelectorAll('canvas'));
  } catch {
    return;
  }
  if (liveCanvases.length === 0 || cloneCanvases.length === 0) return;

  // Build an iteration order that prioritizes canvases inside or
  // near the viewport. When MAX_CANVAS_PIXEL_BYTES is hit, the
  // surviving canvases are the ones the student is actually looking
  // at — off-screen pages further up/down in the PDF get skipped
  // (they're blank in replay but the visible page is preserved, and
  // critically, the trailing DOM — including the chatbot column —
  // stays under MAX_HTML_CHARS so it doesn't get truncated).
  //
  // Distance metric: vertical distance from the viewport's vertical
  // midline to the canvas's center. Canvases overlapping the
  // viewport get distance 0; the further outside, the higher.
  const viewportH = window.innerHeight;
  const viewportMid = viewportH / 2;
  const indexOrder = liveCanvases
    .map((canvas, index) => {
      let distance = Number.POSITIVE_INFINITY;
      try {
        const r = canvas.getBoundingClientRect();
        if (r.bottom < 0 || r.top > viewportH) {
          // Fully offscreen — distance = pixels to the nearest edge.
          distance = r.top > viewportH ? r.top - viewportH : -r.bottom;
        } else {
          distance = Math.abs((r.top + r.bottom) / 2 - viewportMid);
        }
      } catch {
        // No layout (detached, etc.) — push to the back.
      }
      return { index, distance };
    })
    .sort((a, b) => a.distance - b.distance)
    .map((e) => e.index);

  // DOM order is preserved by cloneNode, so the i-th canvas in the
  // clone corresponds to the i-th in the live document. We walk in
  // viewport-distance order but write the replacement back at the
  // original DOM index, so layout stays intact.
  let usedBytes = 0;
  let skippedByBudget = 0;

  for (const index of indexOrder) {
    const liveCanvas = liveCanvases[index]!;
    const cloneCanvas = cloneCanvases[index];
    if (!cloneCanvas) continue;

    // Skip zero-size canvases — they're often offscreen placeholders.
    const width = liveCanvas.width;
    const height = liveCanvas.height;
    if (width <= 0 || height <= 0) continue;

    // Determine quality based on whether this canvas is part of the
    // pdf-viewer region. `closest()` walks ancestors and is cheap.
    const isInPdfViewer = Boolean(liveCanvas.closest('[data-replay-region="pdf-viewer"]'));
    const quality = isInPdfViewer ? PDF_CANVAS_JPEG_QUALITY : OTHER_CANVAS_JPEG_QUALITY;

    let dataUrl: string | null = null;
    try {
      dataUrl = liveCanvas.toDataURL('image/jpeg', quality);
    } catch {
      // Cross-origin / tainted canvas → skip this one, the screenshot
      // fallback at replay time can still surface this region. Use
      // `continue` not `return` — other canvases in this snapshot
      // still need a shot at inlining.
      continue;
    }
    if (!dataUrl) continue;

    // Approximate the data URL's payload size (base64 ≈ 4/3 of raw).
    // Skipping past the budget keeps a runaway PDF from blowing the
    // 12 MB API body limit on its own, AND — critically — keeps the
    // total HTML under MAX_HTML_CHARS so the trailing chatbot column
    // doesn't get truncated.
    const approxBytes = Math.floor((dataUrl.length * 3) / 4);
    if (usedBytes + approxBytes > MAX_CANVAS_PIXEL_BYTES) {
      skippedByBudget += 1;
      continue;
    }
    usedBytes += approxBytes;

    // Replace the empty <canvas> in the clone with a same-sized <img>
    // so the layout doesn't reflow. CSS width / height preserve the
    // displayed size (canvas can be drawn at a different intrinsic
    // resolution than its CSS box — re-apply both).
    try {
      const img = clone.ownerDocument!.createElement('img');
      img.src = dataUrl;
      img.setAttribute('data-replay-canvas-replacement', '1');
      img.setAttribute('width', String(width));
      img.setAttribute('height', String(height));
      // Mirror the canvas's computed CSS box if available so the
      // image lands at the right on-screen size.
      const liveRect = liveCanvas.getBoundingClientRect();
      if (liveRect.width > 0 && liveRect.height > 0) {
        img.style.width = `${liveRect.width}px`;
        img.style.height = `${liveRect.height}px`;
      }
      // Preserve attributes that affect layout (class, style merge).
      const cls = cloneCanvas.getAttribute('class');
      if (cls) img.setAttribute('class', cls);
      const inlineStyle = cloneCanvas.getAttribute('style');
      if (inlineStyle) img.setAttribute('style', `${inlineStyle};${img.style.cssText}`);
      cloneCanvas.replaceWith(img);
    } catch {
      // Replacement failure — fall through. Clone canvas stays blank.
    }
  }

  if (skippedByBudget > 0) {
    // One-line warn, intentionally noisy so this surfaces if the cap
    // starts biting on real PDFs.
    // eslint-disable-next-line no-console
    console.warn(
      `[session-replay] Canvas inline budget hit: ${skippedByBudget} canvas(es) skipped (used ${Math.round(
        usedBytes / 1024,
      )} KB of ${Math.round(MAX_CANVAS_PIXEL_BYTES / 1024)} KB).`,
    );
  }
}

/**
 * Capture per-element scroll positions so the replay can restore the
 * inner state of scroll containers (PDF reader, MDX lesson body,
 * sidebar, anything with overflow:auto/scroll). Without this, every
 * scrollable container in the replay opens at scrollTop=0 even when
 * the student was scrolled halfway through — the captured DOM still
 * holds all the content, but the scroll offset is lost.
 *
 * Strategy: walk the live document for elements whose scrollTop or
 * scrollLeft is non-zero. Stamp the corresponding clone element with
 * `data-replay-scroll-top` / `data-replay-scroll-left` attributes
 * (numbers). At replay time the ReplayTab queries `[data-replay-
 * scroll-top]` inside the iframe's contentDocument on the buffer's
 * `onLoad` and applies the recorded offsets.
 *
 * Index-matched against the clone's element list — same pattern as
 * `inlineCanvasPixels`. Must run BEFORE script removal so the indices
 * match. Triple try/catch per the capture-failure-never-blocks
 * invariant.
 *
 * NOTE: this is the in-clone marker (read on iframe.onload). The
 * parallel typed payload that gets PERSISTED to the
 * `session_replay_snapshots.scroll_hosts` column is built by
 * `captureScrollHosts()` from the same live walk — duplicate work but
 * each side has a distinct consumer: the markers drive the iframe
 * restore; the JSON column drives the CSV export and any future
 * researcher tooling that doesn't want to round-trip through the
 * captured HTML.
 */
function captureScrollPositions(clone: HTMLHtmlElement): void {
  let liveAll: Element[];
  let cloneAll: Element[];
  try {
    liveAll = Array.from(document.querySelectorAll('*'));
    cloneAll = Array.from(clone.querySelectorAll('*'));
  } catch {
    return;
  }
  // cloneNode preserves DOM order so indices line up. If the
  // collections diverge in length (shouldn't, but defensive), the
  // shorter one wins — extras are skipped.
  const limit = Math.min(liveAll.length, cloneAll.length);
  for (let i = 0; i < limit; i++) {
    try {
      const live = liveAll[i] as HTMLElement;
      if (!live) continue;
      // Skip the document scaffolding — `<html>` / `<head>` / `<body>`
      // are not scroll hosts in any meaningful sense for inner-scroll
      // restore. They were getting stamped previously because the
      // user agent reports a non-zero `scrollTop` on `<html>` (it is
      // the document scrolling element) and the walk used to grab
      // them indiscriminately. The window-scroll path
      // (`iframe.contentWindow.scrollTo`) restores body/window scroll
      // separately — duplicating it here causes bogus markers like
      // `data-replay-scroll-top="61"` on `<head>`.
      const tag = live.tagName;
      if (tag === 'HTML' || tag === 'HEAD' || tag === 'BODY') continue;
      // Most elements have scrollTop === 0 → cheap early-out keeps
      // the per-snapshot loop fast even on large documents.
      const top = live.scrollTop ?? 0;
      const left = live.scrollLeft ?? 0;
      if (top === 0 && left === 0) continue;
      const cloneEl = cloneAll[i] as HTMLElement;
      if (!cloneEl) continue;
      if (top > 0) cloneEl.setAttribute('data-replay-scroll-top', String(Math.round(top)));
      if (left > 0) cloneEl.setAttribute('data-replay-scroll-left', String(Math.round(left)));
    } catch {
      // Per-element failure — skip and continue.
    }
  }
}

/**
 * Build the typed `scrollHosts` payload (parallel to
 * `captureScrollPositions`, which stamps DOM markers). One entry per
 * element whose scrollTop OR scrollLeft is non-zero, plus one entry
 * per `[data-replay-region]` panel even when scrollTop=0 (so the CSV
 * export has a stable, always-present row for each panel — useful for
 * researchers tracking when the lesson column is "at top" vs scrolled
 * into the body).
 *
 * Returns undefined on failure / empty so the snapshot field is
 * omitted entirely (Prisma.JsonNull on the backend) rather than
 * persisting an empty array that downstream consumers might mis-read
 * as "captured but blank".
 *
 * Triple-defensive try/catch per the capture-failure-never-blocks
 * invariant. Per-element try/catch so a single broken element can't
 * tank the whole capture.
 */
function captureScrollHosts(): ReplayScrollHost[] | undefined {
  try {
    const hosts: ReplayScrollHost[] = [];
    const seen = new Set<Element>();

    const addHost = (el: HTMLElement, region: string | null) => {
      if (seen.has(el)) return;
      try {
        const scrollTop = el.scrollTop ?? 0;
        const scrollLeft = el.scrollLeft ?? 0;
        const scrollHeight = el.scrollHeight ?? 0;
        const scrollWidth = el.scrollWidth ?? 0;
        const clientHeight = el.clientHeight ?? 0;
        const clientWidth = el.clientWidth ?? 0;
        // Skip elements that don't actually overflow — they have no
        // useful scroll state to record. We still include zero-scroll
        // panels (tagged via [data-replay-region]) below so each
        // panel gets a row in the CSV.
        const overflows = scrollHeight > clientHeight + 1 || scrollWidth > clientWidth + 1;
        if (!overflows && !region) return;
        // 0 → 0/0 = NaN; clamp to a safe 0 so the JSON is well-formed.
        const maxScroll = Math.max(0, scrollHeight - clientHeight);
        const scrollTopPercent = maxScroll > 0 ? scrollTop / maxScroll : 0;
        seen.add(el);
        hosts.push({
          region,
          selector: buildSelectorPath(el),
          scrollTop: Math.round(scrollTop),
          scrollLeft: Math.round(scrollLeft),
          scrollHeight: Math.round(scrollHeight),
          scrollWidth: Math.round(scrollWidth),
          clientHeight: Math.round(clientHeight),
          clientWidth: Math.round(clientWidth),
          scrollTopPercent: Math.round(scrollTopPercent * 10000) / 10000,
        });
      } catch {
        // Per-element failure — skip this one and keep going.
      }
    };

    // 1. Always include every tagged AOI panel — even at scrollTop=0
    //    — so the CSV has a stable per-panel row. The recorder needs
    //    the host's region label to align across snapshots and to
    //    feed the per-AOI scroll columns in the export.
    try {
      const regions = document.querySelectorAll<HTMLElement>('[data-replay-region]');
      regions.forEach((el) => {
        const region = el.getAttribute('data-replay-region');
        // The tagged element itself usually IS the scroll host (e.g.
        // the lesson column has data-replay-region="lesson" AND
        // overflow-y-auto). When it's not, walk down to find the
        // nearest scrollable descendant inside this region.
        const host = findInnerScrollHost(el) ?? el;
        addHost(host, region ?? null);
      });
    } catch {
      // ignore enumeration failure — fall through to the generic walk
    }

    // 2. Also include any element with non-zero scroll that wasn't
    //    already added. Captures untagged scroll containers (e.g.
    //    annotation panels, intervention popovers) so nothing is
    //    silently lost.
    try {
      const all = document.querySelectorAll<HTMLElement>('*');
      all.forEach((el) => {
        try {
          // Skip document scaffolding for the same reason as
          // captureScrollPositions — these are not inner scroll
          // hosts; the window-scroll path handles them.
          const tag = el.tagName;
          if (tag === 'HTML' || tag === 'HEAD' || tag === 'BODY') return;
          const top = el.scrollTop ?? 0;
          const left = el.scrollLeft ?? 0;
          if (top === 0 && left === 0) return;
          addHost(el, null);
        } catch {
          // per-element failure
        }
      });
    } catch {
      // ignore enumeration failure
    }

    return hosts.length > 0 ? hosts : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Walk down from a tagged region to find the nearest overflowing
 * scroll container. Used so a wrapper that itself doesn't scroll
 * (e.g. the `<div data-replay-region="pdf-viewer">` wrapper around
 * PdfReader, which is the AOI box but NOT the scroll host) still maps
 * to the right scroll state. Breadth-first, stops at the first hit.
 */
function findInnerScrollHost(root: HTMLElement): HTMLElement | null {
  try {
    // If root itself overflows, it IS the host.
    if (root.scrollHeight > root.clientHeight + 1 || root.scrollWidth > root.clientWidth + 1) {
      return root;
    }
    const queue: HTMLElement[] = [root];
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const child of Array.from(node.children) as HTMLElement[]) {
        try {
          // Region boundary: if a descendant carries its own
          // `data-replay-region`, its scroll state belongs to THAT
          // region, not to `root`. Stopping here is what prevents the
          // outer `lesson` panel from "claiming" the PDF's scroll
          // host when `pdf-viewer` is nested inside `lesson` in the
          // docked layout — otherwise `seen` dedup in
          // `captureScrollHosts` swallows the `pdf-viewer` entry.
          if (child.hasAttribute('data-replay-region')) continue;
          if (
            child.scrollHeight > child.clientHeight + 1 ||
            child.scrollWidth > child.clientWidth + 1
          ) {
            return child;
          }
          queue.push(child);
        } catch {
          // skip child
        }
      }
    }
  } catch {
    // fall through
  }
  return null;
}

/**
 * Best-effort, bounded-depth CSS selector for an element. Used to
 * re-locate scroll hosts inside the iframe (or in offline analysis)
 * when the host doesn't carry a `data-replay-region` anchor. Caps at
 * 6 ancestors and 80 chars so a deep React tree doesn't produce a
 * 1KB selector string per host.
 */
function buildSelectorPath(el: HTMLElement): string | null {
  try {
    const parts: string[] = [];
    let cur: HTMLElement | null = el;
    let depth = 0;
    while (cur && cur !== document.documentElement && depth < 6) {
      let part = cur.tagName.toLowerCase();
      if (cur.id) {
        part += `#${cur.id}`;
        parts.unshift(part);
        break; // id is unique-enough — stop walking up
      }
      const cls = cur.getAttribute('class') ?? '';
      if (cls) {
        const first = cls.split(/\s+/).find(Boolean);
        if (first) part += `.${first}`;
      }
      parts.unshift(part);
      cur = cur.parentElement;
      depth += 1;
    }
    const out = parts.join('>');
    return out.length > 0 ? out.slice(0, 80) : null;
  } catch {
    return null;
  }
}

/**
 * Capture the PDF reader's semantic state (current page + total
 * pages) for snapshot persistence and CSV export. Reads the
 * `data-replay-pdf-current-page` / `data-replay-pdf-total-pages`
 * attributes that PdfReader puts on its root.
 *
 * Returns `null` (not an exception) when no PdfReader is on screen
 * — the snapshot just omits those columns. When a PDF is on screen
 * but the attributes are missing/malformed, also returns null so we
 * don't write a misleading "page 0 of 0" anchor.
 *
 * Why this exists even though PdfReader renders all pages (not
 * virtualized): the captured DOM serializes the rendered pages as
 * <canvas> elements which get replaced with <img>s by
 * `inlineCanvasPixels`. Those images decode asynchronously inside
 * the iframe — by the time iframe.onload fires, the scroll host's
 * content height may not be final, so a captured scrollTop=5000
 * silently clamps to scrollHeight=0 → still at page 1. Restore code
 * uses the page anchor as a fallback target (scrollIntoView the page
 * wrapper that carries the matching `data-replay-pdf-page` attribute).
 */
function capturePdfState(): { currentPage: number; totalPages: number } | null {
  try {
    const reader = document.querySelector<HTMLElement>('[data-replay-pdf-current-page]');
    if (!reader) return null;
    const curStr = reader.getAttribute('data-replay-pdf-current-page');
    const totStr = reader.getAttribute('data-replay-pdf-total-pages');
    const cur = curStr ? Number(curStr) : NaN;
    const tot = totStr ? Number(totStr) : NaN;
    if (!Number.isFinite(cur) || cur < 1) return null;
    if (!Number.isFinite(tot) || tot < 1) return null;
    return { currentPage: Math.round(cur), totalPages: Math.round(tot) };
  } catch {
    return null;
  }
}

function serializeDocument(): string {
  let clone: HTMLHtmlElement | null = document.documentElement.cloneNode(true) as HTMLHtmlElement;
  syncInputState(document, clone);
  // Inline canvas pixels BEFORE removing scripts — script removal can
  // skip past canvas elements, but the per-canvas walk needs the
  // clone's structure intact and identical in DOM order to the live
  // document so index-matching works.
  try {
    inlineCanvasPixels(clone);
  } catch {
    // Capture failure must never block a snapshot.
  }
  // Scroll-position capture also relies on index-matched walks, so
  // it must run before script removal too.
  try {
    captureScrollPositions(clone);
  } catch {
    // Capture failure must never block a snapshot.
  }

  clone.querySelectorAll('script').forEach((node) => node.remove());
  clone.querySelectorAll('noscript').forEach((node) => node.remove());

  let head = clone.querySelector('head');
  if (!head) {
    head = document.createElement('head');
    clone.insertBefore(head, clone.firstChild);
  }
  if (!head.querySelector('base')) {
    const base = document.createElement('base');
    base.setAttribute('href', window.location.origin);
    head.prepend(base);
  }

  const style = document.createElement('style');
  style.textContent = `
    *, *::before, *::after { animation: none !important; transition: none !important; caret-color: transparent !important; }
    html, body { pointer-events: none !important; }
  `;
  head.appendChild(style);

  const raw = `<!DOCTYPE html>\n${clone.outerHTML}`;
  clone = null; // release DOM clone before string operations to reduce peak heap usage
  if (raw.length > MAX_HTML_CHARS) {
    // Loud warning so this surfaces in the browser console next time
    // the DOM outgrows the cap (don't repeat the previous silent
    // truncation that dropped the docked chatbot).
    // eslint-disable-next-line no-console
    console.warn(
      `[session-replay] Snapshot HTML truncated: ${raw.length} > ${MAX_HTML_CHARS} chars. ` +
        `Trailing DOM (likely the right-most column / floating widgets) will be missing from replay.`,
    );
    return raw.slice(0, MAX_HTML_CHARS);
  }
  return raw;
}

export function useSessionReplayRecorder({
  sessionId,
  userId,
  enabled = true,
  captureDom = false,
}: UseSessionReplayRecorderParams) {
  const bufferRef = useRef<ReplaySnapshotPayload[]>([]);
  const lastSerializedRef = useRef('');
  const flushTimerRef = useRef<ReturnType<typeof setInterval>>();
  const periodicTimerRef = useRef<ReturnType<typeof setInterval>>();
  const screenStreamRef = useRef<MediaStream | null>(null);
  const screenVideoRef = useRef<HTMLVideoElement | null>(null);
  const screenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  // True when the stream came from PermissionGate. Gate streams must NOT be
  // stopped in the effect cleanup — React StrictMode runs cleanup+remount once
  // in dev, and stopping the tracks on the first cleanup would kill the live
  // stream before the second mount can reuse it. Gate streams are stopped by
  // clearPermittedScreenStream() on logout or by the browser's stop-sharing UI.
  const streamFromGateRef = useRef(false);

  const flush = useCallback(
    async (useKeepalive = false) => {
      if (bufferRef.current.length === 0) return;
      const events = bufferRef.current.splice(0);
      const chunks = splitIntoSizedChunks(sessionId, userId, events);

      if (useKeepalive) {
        chunks.forEach((chunk) => {
          sendKeepalive({ sessionId, userId, events: chunk });
        });
        return;
      }

      try {
        for (const chunk of chunks) {
          await api.post('/logs/replay-snapshots', {
            sessionId,
            userId,
            events: chunk,
          });
        }
      } catch {
        bufferRef.current.unshift(...events);
      }
    },
    [sessionId, userId],
  );

  const captureScreenshot = useCallback((): string | undefined => {
    const video = screenVideoRef.current;
    if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return undefined;

    const width = Math.max(1, Math.floor(video.videoWidth || window.innerWidth));
    const height = Math.max(1, Math.floor(video.videoHeight || window.innerHeight));
    let canvas = screenCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      screenCanvasRef.current = canvas;
    }
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(video, 0, 0, width, height);
    return canvas.toDataURL('image/jpeg', 0.7);
  }, []);

  const captureSnapshot = useCallback(
    (trigger: string) => {
      // DOM serialisation — skipped when captureDom is false to avoid the
      // per-snapshot 500 KB–5 MB HTML payload that drives most DB growth.
      let html: string | undefined;
      if (captureDom) {
        html = serializeDocument();
        // Deduplicate periodic DOM snapshots: skip if the page hasn't changed.
        if (trigger === 'periodic' && html === lastSerializedRef.current) return;
        lastSerializedRef.current = html;
      }

      let aois: ReplayAoiRect[] | undefined;
      let scrollHosts: ReplayScrollHost[] | undefined;
      let pdfState: { currentPage: number; totalPages: number } | null = null;
      try {
        aois = captureAois();
      } catch {
        aois = undefined;
      }
      try {
        scrollHosts = captureScrollHosts();
      } catch {
        scrollHosts = undefined;
      }
      try {
        pdfState = capturePdfState();
      } catch {
        pdfState = null;
      }
      bufferRef.current.push({
        pageUrl: window.location.pathname + window.location.search + window.location.hash,
        ...(html !== undefined ? { html } : {}),
        screenshotDataUrl: captureScreenshot(),
        width: window.innerWidth,
        height: window.innerHeight,
        scrollX: window.scrollX,
        scrollY: window.scrollY,
        capturedAt: Date.now(),
        trigger,
        ...(aois ? { aois } : {}),
        ...(scrollHosts ? { scrollHosts } : {}),
        ...(pdfState
          ? { pdfCurrentPage: pdfState.currentPage, pdfTotalPages: pdfState.totalPages }
          : {}),
      });
      if (bufferRef.current.length > 15) {
        bufferRef.current.splice(0, bufferRef.current.length - 15);
      }
    },
    [captureDom, captureScreenshot],
  );

  useEffect(() => {
    if (!enabled || !sessionId || !userId) return;

    const initScreenCapture = async () => {
      try {
        // Use the stream pre-obtained by PermissionGate when available so
        // the browser doesn't show a second prompt. We PEEK (not take) so
        // React StrictMode's cleanup+remount cycle can reuse the same stream
        // on the second mount without calling getDisplayMedia() again.
        const gateStream = peekPermittedScreenStream();
        let stream: MediaStream;
        if (gateStream) {
          stream = gateStream;
          streamFromGateRef.current = true;
        } else {
          stream = await navigator.mediaDevices.getDisplayMedia({ video: true, audio: false });
          streamFromGateRef.current = false;
        }
        screenStreamRef.current = stream;
        const video = document.createElement('video');
        video.muted = true;
        video.playsInline = true;
        video.srcObject = stream;
        await video.play();
        screenVideoRef.current = video;
      } catch {
        // User denied or stream unusable — no screenshots.
      }
    };

    void initScreenCapture().finally(() => {
      captureSnapshot('initial');
    });

    const onPageHide = () => {
      captureSnapshot('pagehide');
      flush(true);
    };
    const onBeforeUnload = () => {
      captureSnapshot('beforeunload');
      flush(true);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        captureSnapshot('hidden');
        flush(true);
      }
    };
    const onRouteChange = () => captureSnapshot('route');

    const originalPushState = window.history.pushState.bind(window.history) as History['pushState'];
    const originalReplaceState = window.history.replaceState.bind(
      window.history,
    ) as History['replaceState'];
    window.history.pushState = ((...args: Parameters<History['pushState']>) => {
      const result = originalPushState(...args);
      window.dispatchEvent(new Event('ats:route-change'));
      return result;
    }) as History['pushState'];
    window.history.replaceState = ((...args: Parameters<History['replaceState']>) => {
      const result = originalReplaceState(...args);
      window.dispatchEvent(new Event('ats:route-change'));
      return result;
    }) as History['replaceState'];

    window.addEventListener('popstate', onRouteChange);
    window.addEventListener('hashchange', onRouteChange);
    window.addEventListener('ats:route-change', onRouteChange);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('beforeunload', onBeforeUnload);
    document.addEventListener('visibilitychange', onVisibilityChange);

    flushTimerRef.current = setInterval(() => {
      void flush(false);
    }, FLUSH_INTERVAL_MS);
    periodicTimerRef.current = setInterval(() => {
      captureSnapshot('periodic');
    }, PERIODIC_SNAPSHOT_MS);

    return () => {
      window.removeEventListener('popstate', onRouteChange);
      window.removeEventListener('hashchange', onRouteChange);
      window.removeEventListener('ats:route-change', onRouteChange);
      window.removeEventListener('pagehide', onPageHide);
      window.removeEventListener('beforeunload', onBeforeUnload);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.history.pushState = originalPushState;
      window.history.replaceState = originalReplaceState;
      clearInterval(flushTimerRef.current);
      clearInterval(periodicTimerRef.current);
      // Gate-provided streams survive cleanup so React StrictMode's second
      // mount can reuse them. clearPermittedScreenStream() (called on logout)
      // is responsible for stopping those tracks. Self-obtained streams
      // (getDisplayMedia fallback for teacher accounts) are stopped here.
      if (!streamFromGateRef.current) {
        screenStreamRef.current?.getTracks().forEach((track) => track.stop());
      }
      screenStreamRef.current = null;
      screenVideoRef.current = null;
      screenCanvasRef.current = null;
      captureSnapshot('cleanup');
      void flush(false);
    };
  }, [captureSnapshot, enabled, flush, sessionId, userId]);
}
