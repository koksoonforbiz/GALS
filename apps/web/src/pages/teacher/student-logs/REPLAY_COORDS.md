# Replay coordinate contract

Short reference for the three distinct coordinate spaces the session
replay pipeline carries per snapshot. If you change a recorder
capture path or a CSV column, read this first.

The canonical capture site is
`apps/web/src/lib/interaction-log/useSessionReplayRecorder.ts` —
`captureSnapshot()` and its three helpers (`captureAois`,
`captureScrollHosts`, `capturePdfState`). The doc-comment in front of
`ReplaySnapshotPayload` there is the source of truth; this file is
the "where to find what" pointer.

## The three spaces

### 1. AOI rects (`aois[]`)

- **Units:** viewport-relative CSS pixels (NOT scaled by
  devicePixelRatio).
- **Origin:** top-left of the browser viewport — same as
  `DOMRect.top` / `clientX` / `clientY`.
- **What it answers:** "where on screen was the lesson panel at
  capture time?" Used by the replay overlay and the AOI scoring
  kernel (per-AOI PDT against the SEEV expected distribution).
- **Captured from:** every `[data-replay-region]` element with a
  non-zero `getBoundingClientRect()`.
- **CSV rows:** `aoi_<panel>_x`, `aoi_<panel>_y`, `aoi_<panel>_w`,
  `aoi_<panel>_h` (one set per scored panel), plus the legacy
  `aoi_active_regions` comma list.

### 2. Scroll hosts (`scrollHosts[]`)

- **Units:** in-host CSS pixels — `scrollTop` is the offset
  inside the host's own content box, NOT relative to the viewport.
- **What it answers:** "how far down was the student inside the
  PDF reader / lesson column at capture time?" Needed because
  `window.scrollY` is a dead signal in the docked course-view
  layout — both the lesson MDX and the PDF reader scroll inside
  inner `overflow-y-auto` containers, not the window.
- **Captured from:** any tagged region whose own (or nearest
  scrollable descendant's) `scrollHeight > clientHeight`, plus any
  other element with non-zero `scrollTop` / `scrollLeft`.
- **CSV rows:** `scroll_top_<panel>` (in-host px),
  `scroll_percent_<panel>` (0–1 of `scrollHeight - clientHeight`).

### 3. PDF semantic anchor (`pdfCurrentPage` / `pdfTotalPages`)

- **Units:** 1-based page number; total page count.
- **What it answers:** "what PDF page was the student looking at?"
  Used as a fallback restore target — `scrollIntoView` the matching
  `[data-replay-pdf-page]` page wrapper — for the (common) case where
  the captured `scrollTop` doesn't restore cleanly because the PDF's
  canvas-to-`<img>` replacements are still decoding when
  `iframe.onload` fires.
- **Captured from:** the `data-replay-pdf-current-page` /
  `data-replay-pdf-total-pages` attributes that `PdfReader.tsx` puts
  on its root.
- **CSV rows:** `pdf_current_page`, `pdf_total_pages`.

## Why all three

You need spaces 1 and 2 to fully describe layout-and-state for one
snapshot. A panel can sit at viewport y=80 (AOI) AND have
scrollTop=1248 inside it (scroll host) — both are independent and
both matter for downstream analysis. Space 3 is a semantic fallback
for the PDF reader specifically — the reader renders all pages (not
virtualized), so scroll restoration is usually enough, but the page
anchor lets the replay always land on the right page even when the
exact scroll-px restore is off by an image-decode cycle.

## Migration trail

- `20260507000000_add_session_replay_snapshots` — base table.
- `20260514000000_add_replay_screenshot_data_url` — screenshot col.
- `20260528000000_add_replay_snapshot_aois` — AOI rects (space 1).
- `20260601010000_add_replay_snapshot_scroll_hosts_and_pdf` —
  scroll hosts + PDF anchor (spaces 2 and 3).

All snapshot columns are nullable / defaulted. The backend coerces
malformed JSON to `Prisma.JsonNull` so a bad client payload never
blocks a snapshot insert — see `apps/api/src/logs/logs.service.ts`
`batchReplaySnapshots()`.
