-- P06: per-snapshot inner-scroll-host state + PDF page anchor.
--
-- Window.scrollY is a dead signal in the docked course-view layout
-- because both the lesson MDX and the PDF reader scroll inside inner
-- `overflow-y-auto` containers, not the window. The recorder now
-- captures per-scroll-host state (scrollTop / scrollHeight /
-- clientHeight + the host's data-replay-region label when present)
-- and, separately, the PDF reader's current page + total page count
-- so the replay can restore the exact reading position even though
-- the iframe is sandbox `allow-same-origin` (no JS execution inside).
--
-- All three columns are nullable: pre-existing rows have no per-host
-- capture, and the recorder is best-effort — anything throwing inside
-- the triple-defensive try/catch in `captureScrollHosts()` /
-- `capturePdfState()` is omitted from the payload so the snapshot
-- still saves. Backend coerces non-array `scroll_hosts` payloads to
-- Prisma.JsonNull (same defense as the existing `aois` column).
--
-- Shape of `scroll_hosts`:
--   [{
--     "region": "pdf-viewer" | "lesson" | "sidebar" | "chatbot" | null,
--     "selector": "div.flex-1.bg-gray-100" | null,
--     "scrollTop": 1248,
--     "scrollLeft": 0,
--     "scrollHeight": 8420,
--     "scrollWidth": 980,
--     "clientHeight": 720,
--     "clientWidth": 980,
--     "scrollTopPercent": 0.16
--   }, ...]
ALTER TABLE "session_replay_snapshots"
  ADD COLUMN "scroll_hosts" JSONB,
  ADD COLUMN "pdf_current_page" INTEGER,
  ADD COLUMN "pdf_total_pages" INTEGER;
