# Stage 01 — Session Bundle Format + Exporter

**Run this prompt in Claude Code from inside the live GALS monorepo** (the one
with `apps/api` NestJS + Prisma + Postgres + MinIO). You will (a) lock down a
portable bundle format and (b) build a standalone exporter that turns one
student session into a self-contained bundle folder, with **no Postgres or
MinIO dependency after export**.

---

## Context

GALS runs on study laptops (Docker: Postgres + Redis + MinIO + api + web). After
a session, the researcher needs to copy that session's data to a central
computer for analysis in a separate app (GALS Studio). MinIO and Postgres do not
travel well between machines, so we export each session into a flat,
file-based **bundle** that the analysis app can import.

Data captured per session (authoritative inventory — match these tables):
`student_sessions`, `session_sync_anchors`, `activity_logs`,
`session_replay_snapshots` (DOM `html`, `screenshotDataUrl`, `width`, `height`,
`scrollX`, `scrollY`, `aois` JSONB, `scrollHosts` JSONB, `pdfCurrentPage`,
`pdfTotalPages`, `trigger`, `pageUrl`, `capturedAt`), `click_logs`,
`scroll_logs`, `cursor_logs`, `keystroke_logs`, `clipboard_logs`,
`visibility_logs`, `viewport_logs`, `webgazer_logs`, `pupil_size_logs`,
`emotion_frames`, `pyfeat_au_results` (+ `pyfeat_jobs`), `recording_segments`
(MP4 in MinIO), `openface3_jobs`, `chatbot_messages`, `dialogue_messages`,
`learning_interventions`, `ef_detections`, `user_mastery`,
`spaced_repetition_cards`, `attempts`, and (if present)
`replay_annotations` + `replay_codes` and any `probe_responses`.

All replay computations key off **wall-clock milliseconds**. `baseWallClockMs`
is the earliest of the sync anchor / first snapshot / `session.startedAt`.

---

## Task 1 — Write the bundle spec

Create `tools/gals-export/BUNDLE_SPEC.md` describing version `1` of the format.
The layout is:

```
session_<sessionId>/
  manifest.json
  session.json
  streams/
    webgazer.jsonl        pupil.jsonl        emotion_frames.jsonl
    au_results.jsonl      clicks.jsonl       scrolls.jsonl
    cursors.jsonl         keystrokes.jsonl   clipboard.jsonl
    visibility.jsonl      viewport.jsonl     activity.jsonl
  snapshots/
    index.json
    <snapshotId>.html
    <snapshotId>.jpg        (only when a screenshot exists)
  webcam/
    index.json
    <segmentId>.mp4
  messages/
    chatbot.jsonl  dialogue.jsonl  interventions.jsonl  ef_detections.jsonl
  kc/
    mastery.jsonl  cards.jsonl  attempts.jsonl
  probes/
    probes.jsonl            (optional; omit file if none)
  annotations/
    annotations.jsonl  codes.jsonl   (optional; pre-existing labels to carry over)
```

Spec rules to write down and enforce:

- **`manifest.json`** fields: `bundleVersion` (=1), `exporterVersion`,
  `exportedAt` (ISO), `sessionId`, `userId`, `courseId`, `moduleId?`,
  `timezone`, `baseWallClockMs`, `durationMs`, `counts` (per stream/file row
  counts), `files` (relative path → sha256 + byteSize), and `notes`.
- **`session.json`**: the `student_sessions` row, the `session_sync_anchors`
  row, and minimal course/module/user context (display names only — no
  credentials, no API keys, no email/password). Strip anything sensitive.
- **Streams** are **JSONL** (one JSON object per line). Every record carries an
  absolute `wallMs` (number, wall-clock ms) plus the stream's native fields.
  For records that natively store BigInt timestamps, convert to a normal number
  of milliseconds (ms fits safely in a JS number; document this). Keep original
  field names where reasonable (e.g. gaze: `x`, `y`, `confidence`,
  `eyeFeatures?`; pupil: `left`, `right`; emotion: 8-class probabilities +
  `dominant`; AUs: `au01..au45` intensities; clicks: `x`,`y`,`target`,`pageUrl`).
- **`snapshots/index.json`**: ordered-by-`capturedAt` array of
  `{ snapshotId, wallMs, trigger, pageUrl, width, height, scrollX, scrollY,
  aois, scrollHosts, pdfCurrentPage, pdfTotalPages, htmlFile, screenshotFile? }`.
  Write the DOM `html` to `<snapshotId>.html` verbatim (it already has scripts
  stripped and `<base href>` injected by the recorder — keep it as-is). Decode
  `screenshotDataUrl` (data:image/jpeg;base64,...) to `<snapshotId>.jpg`.
- **`webcam/index.json`**: array of `{ segmentId, startWallMs, endWallMs?, file,
  byteSize, status }`. Pull each MP4 from MinIO using the stored blob key and
  write it to disk. If a segment is missing/failed in MinIO, record it in the
  index with `status:"missing"` and **do not abort** the export.
- **Time alignment for webcam:** derive each segment's `startWallMs` from the
  `recording_segments` row (and/or its first emotion frame's wall time). Document
  the exact derivation so the analysis app can sync the video scrubber.
- All timestamps wall-clock ms; document the anchor logic identical to the live
  ReplayTab so replay in Studio lands at the same `t=0`.

## Task 2 — Build the exporter

Create a standalone CLI at `tools/gals-export/` (its own `package.json`, runs
with `node` or `tsx`, does **not** need the Nest app running — connects directly
to Postgres via a Prisma client or `pg`, and to MinIO via the S3 client already
used in `apps/api/src/recording`). Reuse the live Prisma schema for types.

CLI shape:

```
gals-export \
  --session <sessionId>            # or --all-since <ISO> / --user <id>
  --out ./exports                  # output dir; creates session_<id>/ inside
  --zip                            # also produce session_<id>.zip
  --include-webcam true            # default true; false to skip MP4 (faster)
  --db <postgres-url>              # default from env DATABASE_URL
  --minio <endpoint/creds>         # default from env, same as apps/api
```

Behavior:

- Fetch the session and **every** stream in parallel (mirror
  `LogsService.getSessionReplayData()` fan-out), then write each to its bundle
  file. Stream large tables (cursor, gaze, AU) row-by-row to JSONL to avoid
  loading 65k+ rows into memory.
- **Reuse, don't reinvent, the CSV.** Also emit `signals.csv` by calling the
  same wide-format logic as `exportReplayCsv.ts` if it can be imported
  server-side; if it can't (it's a web module), skip the CSV and note in the
  spec that Studio derives its own binning. (Prefer skipping — Studio will bin
  from raw streams. Do not duplicate the binning logic here.)
- Compute sha256 + byteSize for every written file into `manifest.files`.
- **Idempotent + safe:** if the output folder exists, refuse unless `--force`.
  Wrap every per-table fetch in try/catch; a failure on one stream logs a
  warning and writes an empty file rather than aborting the whole export.
- Print a summary: row counts per stream, total bytes, missing webcam segments,
  and the bundle path.

## Task 3 — Tests + docs

- A smoke test that exports a seeded/sample session (or a fixture DB) and asserts
  the bundle validates against the spec (all required files present, manifest
  checksums match, JSONL parses, every `wallMs` is a finite number).
- A `README.md` for `tools/gals-export/` with copy-paste run instructions for a
  researcher on a study laptop (including `docker compose` env so they can point
  it at the running Postgres + MinIO).

## Acceptance checks

- `gals-export --session <id> --out ./exports --zip` produces a folder + zip.
- `manifest.json` checksums verify against the written files.
- Re-running without `--force` refuses; with `--force` reproduces an identical
  bundle (same checksums, modulo `exportedAt`).
- Deleting the running Postgres/MinIO afterward leaves the bundle fully usable
  (no dangling references; every media file is a real local file).

Do **not** build any UI or importer in this stage — the importer lives in the
analysis app (stage 02). Keep this exporter independent of the analysis repo.
