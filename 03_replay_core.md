# Stage 03 — Replay Core (playback, DOM + webcam, signal timeline, overlays)

**Run after stage 02.** Build the replay viewer at `/replay/:sessionId`. This
ports the live GALS **ReplayTab** capabilities into the offline app, reading
from the SQLite store + local media instead of the live API. No coding UI yet
(that's stage 04) — but build the time/clock plumbing cleanly because the
coding studio reuses it.

---

## Context

GALS Studio already imports session bundles into SQLite and serves media. Now
render a synchronized session replay. The live ReplayTab is the reference for
features and algorithms — reproduce its behavior, adapted to local data. Stack:
React + Vite + Tailwind, hand-rolled SVG for the timeline (like the original),
Fastify backend serving JSON + media with range support.

**Clock model (single source of truth — implement in `src/replay/clock.ts`):**
`baseWallClockMs` comes from `Session`. The playhead is `currentAbsoluteMs =
baseWallClockMs + currentOffsetMs`. Every stream sample carries `wallMs`;
relative time is `wallMs - baseWallClockMs`. `durationMs` from `Session`.
Avoid `Math.max(...arr)` over 65k+ samples — use an in-place max walk
(the live code hit a stack overflow doing this).

---

## Task 1 — Data loading

- `GET /api/replay/:sessionId/meta` → session row, durationMs, baseWallClockMs,
  per-stream counts, AOI region names present, whether webcam exists.
- `GET /api/replay/:sessionId/streams?signals=...&from=&to=` → downsampled
  signal series for the timeline (server-side decimation so the client isn't
  handed 100k points; target ≤ ~2k points per series for the viewport).
- `GET /api/replay/:sessionId/snapshots/index` → ordered snapshot index
  (lightweight: ids + wallMs + trigger + pdf page + aois/scrollHosts, **no
  html**).
- `GET /api/replay/:sessionId/snapshots/:snapshotId` → `htmlPath`/screenshot
  refs (the actual bytes come from the media routes built in stage 02).
- Sparse streams (clicks, messages, interventions, ef_detections, visibility,
  probes) loaded in full (they're small) for the timeline + activity panel.

## Task 2 — Playback toolbar

Top toolbar: Play / Pause / Restart, a **seek bar** over `durationMs`, playback
speed (0.5×/1×/2×/4×), current time shown as both relative `mm:ss` (and
`h:mm:ss` for long sessions) and wall-clock. A `requestAnimationFrame` loop
advances `currentOffsetMs`; seeking sets it directly. All panels subscribe to
the playhead.

## Task 3 — Main stage: DOM replay + webcam + overlays

Two-column main grid (left bigger), matching the live tab:

**Left — DOM replay:**
- An `<iframe sandbox="allow-same-origin">` whose `srcdoc` (or `src` to the
  snapshot HTML media route) loads `currentSnapshot` = the last snapshot with
  `wallMs ≤ currentAbsoluteMs` (linear scan over the pre-sorted index).
- Strip `<script>` defensively even though the exporter already did; keep the
  injected `<base href>` so relative CSS/images resolve. Scale-to-fit the
  captured viewport (`width`/`height`) into the available box.
- Above the iframe, a **pixel screenshot** view toggle: show the snapshot JPEG
  when present, else "No pixel snapshot available".
- **Overlays inside the iframe wrapper** (absolutely positioned, scaled to the
  same transform as the iframe):
  - **Gaze marker** (cyan dot) at the interpolated/nearest gaze sample.
  - **Click marker** (amber ring) for the most recent click, fading out.
  - **AOI overlay** — rectangles for `sidebar`/`lesson`/`pdf-viewer`/`chatbot`/
    `header` from the current snapshot's `aois`, with a per-region toggle.

**Right sidebar (stacked panels, collapsible):**
- **Camera frame replay** — `<video>` fed the webcam MP4 segment covering
  `currentAbsoluteMs` (pick segment by `startWallMs..endWallMs`); seek the video
  to `currentAbsoluteMs - segment.startWallMs`. Keep it time-synced to the
  scrubber; if no segment covers the playhead, show "No camera for this moment".
- **Facial Signals** — current 8-class emotion probabilities (bar list),
  rule-based affective-state prediction with **adjustable threshold sliders**
  (engagement/boredom/confusion/frustration), top action units, pupil diameter.
  Sliders are local state and drive the live prediction (same as live tab).
- **Gaze Coverage by Region** — % bar chart of where the student looked,
  computed by a single linear two-pointer pass over gaze samples + snapshots;
  per-gaze nearest-snapshot AOI lookup; **smaller (area-sorted) rectangle wins
  when nested**. Compute on the server (`GET .../coverage`) or client; cache it.
- **Reading position** — current `pdfCurrentPage / pdfTotalPages` and a
  `scrollHosts`-derived `scrollTopPercent` for the `lesson` host. **Do not show
  window `scrollY` as reading progress** — label it raw/diagnostic only; it is
  pinned near 0 in the docked layout and is misleading.
- **Replay State** — URL, viewport, scrollY (diagnostic), gaze coords, current
  expression, last click.
- **Coverage diagnostics** — counts per stream (snapshots, clicks, gazes, AU,
  emotion, webcam segments, messages) so missing data is visible at a glance.

## Task 4 — Signal Timeline (SVG)

Below the toolbar, a wide SVG timeline (`viewBox="0 0 1000 220"`):
- Toggleable polylines for **8 emotions**, **4 affective states**, **18 AUs**
  (grouped, with show/hide per group and per signal).
- X-axis ticks with both relative and wall-clock labels; pick the tick step from
  a human-friendly ladder (a 4 h session → 30-min ticks; a 5-min session → 30 s
  ticks).
- **Click-to-seek** anywhere on the timeline; a vertical playhead line tracks
  `currentOffsetMs`.
- Threshold guide lines reflecting the Facial Signals sliders.
- **Event lanes** beneath the signal area: tick marks for clicks, chat turns,
  interventions, ef_detections, visibility blur spans, and probe prompts —
  clicking a marker seeks to it. (This lane is what the coding studio later
  reuses to jump between windows.)

## Task 5 — Activity & conversation timeline (bottom panel)

Interleaved chronological list of intervention events, EF detections,
dialogue + chatbot turns, and probe responses. Each row shows wall + relative
time and a type badge; clicking a row seeks. Virtualize the list for long
sessions.

## Engineering notes

- All iframe/canvas/video effects wrapped in try/catch — a render failure must
  never blank the whole viewer ("capture failure must never block" invariant,
  applied to playback).
- Memoize derived series; recompute coverage/decimation only on session or range
  change, not per frame.
- Keep `clock.ts`, the playhead store, and the snapshot/segment lookups in
  `src/replay/` as reusable modules — stage 04 imports them directly.

## Acceptance checks

- Opening `/replay/:sessionId` plays back DOM snapshots in sync with the seek
  bar; the iframe updates as the playhead crosses snapshot boundaries.
- Gaze/click/AOI overlays track the playhead and scale correctly with the
  iframe.
- Webcam video stays within ~0.25 s of the scrubber while playing and after
  seeks.
- Toggling timeline signals shows/hides polylines; clicking the timeline seeks;
  threshold sliders move the guide lines and update the affective prediction.
- Gaze Coverage sums to ~100% and nested-region resolution prefers the smaller
  rectangle.
- A session with no webcam still replays everything else with clear "no camera"
  messaging.
