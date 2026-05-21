# Repo Handoff: Changes Added After the Initial Clone

## 1. Origin and intent

This repo started from:

`C:\Users\npanh\Downloads\GALS-claude-text-mining-prompt-editor\GALS-claude-text-mining-prompt-editor`

The imported base landed in this repo as commit `9639418` (`Initial commit`).

After that, the main additions were:

1. A session replay pipeline so teachers can replay what the student saw and did.
2. More session data being persisted into Prisma/PostgreSQL for replay and analysis.
3. Hardening of the py-feat worker so AU/emotion extraction is more stable on real recordings.
4. A Python analysis/export pipeline for backing up and aligning multimodal session data.

If you want the shortest possible summary of "what is custom here", it is:

- Replay snapshots are now recorded in the browser, stored in Prisma, and rendered in the teacher logs UI.
- Long sessions were fixed by paging snapshot loads and lazily fetching full snapshot content.
- Pixel replay now uses real screenshot data when available, and falls back to DOM-rendered images when not.
- AU replay data was fixed to avoid truncation and to be more resilient to bad numeric values in py-feat output.
- There is now an `analysis/` folder for exporting, aligning, and backing up session data.

## 2. Post-import commit history

These are the custom follow-up commits after the base import:

1. `da0292c` on May 20, 2026
   `Fix long-session replay with paged snapshots and pixel/DOM fallback`
2. `747743f` on May 20, 2026
   `Harden pyfeat worker NaN handling and pin kornia compatibility`
3. `64b3510` on May 21, 2026
   `Fix replay truncation of emotion/AU frames`

Those three commits are the best starting points if you want to inspect the history in detail.

## 3. Main feature added: session replay

### What it does

Teachers can open the student logs view and replay a session using:

- DOM snapshots of the student page
- optional screenshot-based pixel replay
- gaze, clicks, scroll position, viewport size, pupil logs, AU data, and job diagnostics

### End-to-end flow

1. The student browser records replay snapshots during a live session.
2. The browser sends snapshots to the API in batches.
3. The API writes them into Prisma/PostgreSQL.
4. The teacher replay page loads replay metadata first, then progressively loads detailed snapshot content.
5. The replay tab overlays other logged modalities on top of the reconstructed page state.

## 4. Frontend replay recording

### Entry point

Replay recording is wired into:

- [apps/web/src/components/LoggingProvider.tsx](d:/kianyu/GALS-milestone-1-monorepo/apps/web/src/components/LoggingProvider.tsx)

`LoggingProvider` now calls both:

- `useInteractionLogger(...)`
- `useSessionReplayRecorder(...)`

That means replay capture is automatically enabled anywhere the existing logging provider is used for a student session.

### Recorder implementation

Main file:

- [apps/web/src/lib/interaction-log/useSessionReplayRecorder.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/web/src/lib/interaction-log/useSessionReplayRecorder.ts)

Key behavior:

- Records one snapshot every `1000 ms` via `PERIODIC_SNAPSHOT_MS`.
- Flushes batched snapshots every `10000 ms`.
- Also captures snapshots on:
  - initial load
  - route change
  - `pagehide`
  - `beforeunload`
  - document becoming hidden
  - cleanup
- Serializes the DOM into HTML.
- Disables animation/transition/caret behavior inside the serialized DOM to make replay more stable.
- Truncates HTML at `MAX_HTML_CHARS = 250000`.
- Splits upload payloads by size using `MAX_BATCH_BYTES = 700000`.

### Screenshot capture

The recorder also tries to capture real screenshots using `navigator.mediaDevices.getDisplayMedia(...)`.

If screen capture succeeds:

- a hidden `<video>` is fed from the screen stream
- a canvas captures frames
- snapshots include `screenshotDataUrl`

If screen capture is unavailable or permission is denied:

- replay still works in DOM-only mode
- the UI later falls back to a DOM-derived image instead of a true screenshot

This is important because the feature is designed to degrade gracefully rather than fail hard.

## 5. Replay data written into Prisma/PostgreSQL

### New table

Replay snapshots are stored in the Prisma model:

- `SessionReplaySnapshot`

Defined in:

- [apps/api/prisma/schema.prisma](d:/kianyu/GALS-milestone-1-monorepo/apps/api/prisma/schema.prisma)

Mapped DB table:

- `session_replay_snapshots`

Important fields:

- `id`
- `sessionId`
- `userId`
- `pageUrl`
- `html`
- `screenshotDataUrl`
- `width`
- `height`
- `scrollX`
- `scrollY`
- `capturedAt`
- `trigger`
- `createdAt`

Index:

- `(sessionId, capturedAt)`

### Migrations added

1. [apps/api/prisma/migrations/20260507000000_add_session_replay_snapshots/migration.sql](d:/kianyu/GALS-milestone-1-monorepo/apps/api/prisma/migrations/20260507000000_add_session_replay_snapshots/migration.sql)
   Creates `session_replay_snapshots`.
2. [apps/api/prisma/migrations/20260514000000_add_replay_screenshot_data_url/migration.sql](d:/kianyu/GALS-milestone-1-monorepo/apps/api/prisma/migrations/20260514000000_add_replay_screenshot_data_url/migration.sql)
   Adds `screenshot_data_url`.

### API write path

DTO:

- [apps/api/src/logs/dto/create-replay-snapshot-batch.dto.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/api/src/logs/dto/create-replay-snapshot-batch.dto.ts)

Controller endpoint:

- [apps/api/src/logs/logs.controller.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/api/src/logs/logs.controller.ts)
- `POST /logs/replay-snapshots`

Service logic:

- [apps/api/src/logs/logs.service.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/api/src/logs/logs.service.ts)
- method: `batchReplaySnapshots(dto)`

The API uses `prisma.sessionReplaySnapshot.createMany(...)` and stores one row per captured replay snapshot.

## 6. Teacher replay read path

### Controller routes

Teacher-facing replay routes live in:

- [apps/api/src/activity-log/activity-log.controller.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/api/src/activity-log/activity-log.controller.ts)

Routes:

- `GET /activity-log/teacher/sessions/:sessionId/replay`
- `GET /activity-log/teacher/sessions/:sessionId/replay/snapshots`
- `GET /activity-log/teacher/sessions/:sessionId/replay/snapshots/:snapshotId`

### Service methods

Read logic lives in:

- [apps/api/src/logs/logs.service.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/api/src/logs/logs.service.ts)

Important methods:

- `getSessionReplayData(sessionId, { includeSnapshots })`
- `getSessionReplaySnapshots(sessionId, { cursor, limit, includeContent })`
- `getSessionReplaySnapshotById(sessionId, snapshotId, { includeScreenshot })`

### Why this changed

The original replay loading strategy was too heavy for long sessions because all snapshot content was loaded too eagerly.

The new design fixes that by splitting the load into two phases:

1. Load session replay metadata without snapshots, or with minimal snapshot fields only.
2. Page through snapshot lists and fetch full snapshot content lazily by snapshot id.

That is the main reason replay is now much more usable for long recordings.

## 7. Teacher replay UI

### Hook

Replay data loading hook:

- [apps/web/src/pages/teacher/student-logs/hooks/useSessionReplay.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/web/src/pages/teacher/student-logs/hooks/useSessionReplay.ts)

What it now does:

- first requests `/replay?includeSnapshots=false`
- tracks total snapshot count
- pages through `/replay/snapshots`
- keeps `snapshotLoadProgress`
- lazily fetches full snapshot content for the currently viewed snapshot
- caches a small number of full snapshots in `snapshotContentById`

The cache is intentionally capped to avoid unbounded memory growth in the teacher UI.

### Replay tab

UI file:

- [apps/web/src/pages/teacher/student-logs/tabs/ReplayTab.tsx](d:/kianyu/GALS-milestone-1-monorepo/apps/web/src/pages/teacher/student-logs/tabs/ReplayTab.tsx)

What the replay tab shows:

- play/pause and timeline controls
- original viewport dimensions
- pixel replay image
- DOM replay inside an iframe
- gaze overlay
- click overlay
- scroll sync
- signal charts
- py-feat/openface diagnostics

### Pixel replay fallback behavior

The tab now prefers:

1. `screenshotDataUrl` if present
2. otherwise a generated image built from the saved DOM snapshot

This is the "pixel/DOM fallback" fix mentioned in the commit history.

### Known UI messages that reflect current behavior

You may see:

- `Loading full-detail replay snapshots (...)`
- `No DOM replay snapshots have been recorded for this session yet.`
- `Loading pixel snapshot...`
- `No pixel snapshot available.`
- `DOM fallback`

Those are expected and help distinguish whether the session has true screenshot data or only DOM-based replay data.

## 8. Replay-related bug fixes

### Fix 1: long-session replay loading

Implemented in commit `da0292c`.

What changed:

- snapshot loading became paginated
- detailed snapshot content became lazy-loaded
- pixel replay can fall back to DOM-generated images

Reason:

- long sessions were too large to load all at once
- replay felt broken or incomplete when screenshots were missing

### Fix 2: replay truncation of emotion/AU frames

Implemented in commit `64b3510`.

Touched file:

- [apps/api/src/logs/logs.service.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/api/src/logs/logs.service.ts)

Reason:

- replay data for emotion/AU overlays could be truncated in some sessions
- this commit adjusts the replay data assembly logic so those frame series are returned more completely

If you continue touching replay, inspect that file carefully before changing any replay aggregation limits.

## 9. py-feat worker hardening

Files changed:

- [apps/pyfeat-worker/db.py](d:/kianyu/GALS-milestone-1-monorepo/apps/pyfeat-worker/db.py)
- [apps/pyfeat-worker/processor.py](d:/kianyu/GALS-milestone-1-monorepo/apps/pyfeat-worker/processor.py)
- [apps/pyfeat-worker/requirements.txt](d:/kianyu/GALS-milestone-1-monorepo/apps/pyfeat-worker/requirements.txt)

### What was fixed

1. `kornia==0.7.1` was pinned for compatibility.
2. Non-finite numeric values from py-feat are sanitized before DB insert.
3. Invalid `face_box` JSON is dropped instead of poisoning inserts.
4. Video FPS is clamped to a sane range.
5. Frame extraction now prefers timestamp-based sampling instead of trusting container FPS too much.

### Why it matters

Without these fixes, py-feat jobs could fail or produce bad rows when:

- the video metadata was inconsistent
- py-feat returned `NaN` or `Infinity`
- face bounding box values were malformed

### Data affected

This work mainly stabilizes writes into existing py-feat tables such as:

- `pyfeat_jobs`
- `pyfeat_au_results`

These were not brand-new tables from this change, but the insert path is now safer.

## 10. Analysis and export pipeline

A new analysis/export workflow exists under:

- [analysis/export_logs.py](d:/kianyu/GALS-milestone-1-monorepo/analysis/export_logs.py)
- [analysis/backup_all_sessions.py](d:/kianyu/GALS-milestone-1-monorepo/analysis/backup_all_sessions.py)
- [analysis/multimodal_sync.py](d:/kianyu/GALS-milestone-1-monorepo/analysis/multimodal_sync.py)
- [analysis/requirements-analysis.txt](d:/kianyu/GALS-milestone-1-monorepo/analysis/requirements-analysis.txt)

### Purpose

This is separate from the live product path. It is for offline analysis, backup, and multimodal alignment.

### `export_logs.py`

Exports one session into structured files.

Capabilities:

- exports raw sensor/log tables
- exports event/session tables
- exports derived analytics tables
- exports sync tables
- exports AU data with joins
- writes `manifest.json`
- can upload the export folder to MinIO

Important tables explicitly included:

- raw logs such as `cursor_logs`, `click_logs`, `scroll_logs`, `visibility_logs`, `viewport_logs`, `performance_logs`, `error_logs`
- session/event data such as `activity_logs`, `learning_interventions`, `attempts`, `dialogue_sessions`, `dialogue_messages`, `recording_segments`, `student_sessions`, `session_summaries`
- sync data such as `session_sync_anchors`, `modality_offsets`

### `multimodal_sync.py`

Builds an aligned master timeline for a session.

It loads:

- sync anchors
- modality offsets
- pupil
- gaze
- AU rows
- cursor
- scroll
- clicks
- visibility
- activity logs
- interventions
- attempts
- recording segments

Then it:

- normalizes timestamps
- applies modality offsets
- builds a frame index from recording segments
- aligns modalities to video frames
- outputs an aligned master dataframe

### `backup_all_sessions.py`

Runs bulk export for all ended sessions.

What it does:

- finds sessions where `student_sessions.endedAt IS NOT NULL`
- skips ones already recorded in a local SQLite tracking DB
- exports each session
- attempts aligned export
- uploads to MinIO
- records completion in `export_log.sqlite`

This is the clearest sign that the repo now supports an offline research/analysis workflow in addition to the product UI.

## 11. What "more data into Prisma" means in practice

The most important new persisted data for the app itself is replay data:

- `session_replay_snapshots` rows now store serialized page state and optional screenshot data

The existing biometric pipeline also became more dependable:

- py-feat AU rows are less likely to fail insert because bad numeric values are sanitized first

For offline analysis, more existing session tables are now being exported and aligned together, but those scripts mostly read from Prisma/PostgreSQL rather than writing back into it.

## 12. How to continue the work

### If you want to continue replay work

Start with these files:

- [apps/web/src/lib/interaction-log/useSessionReplayRecorder.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/web/src/lib/interaction-log/useSessionReplayRecorder.ts)
- [apps/web/src/pages/teacher/student-logs/hooks/useSessionReplay.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/web/src/pages/teacher/student-logs/hooks/useSessionReplay.ts)
- [apps/web/src/pages/teacher/student-logs/tabs/ReplayTab.tsx](d:/kianyu/GALS-milestone-1-monorepo/apps/web/src/pages/teacher/student-logs/tabs/ReplayTab.tsx)
- [apps/api/src/logs/logs.service.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/api/src/logs/logs.service.ts)
- [apps/api/src/activity-log/activity-log.controller.ts](d:/kianyu/GALS-milestone-1-monorepo/apps/api/src/activity-log/activity-log.controller.ts)

Things to be careful with:

- do not reintroduce eager loading of all snapshot HTML/screenshots for long sessions
- be mindful that screenshot capture may be unavailable, so DOM fallback must keep working
- replay uses multiple time sources, so any timestamp changes should be tested against long recordings

### If you want to continue py-feat work

Start with:

- [apps/pyfeat-worker/processor.py](d:/kianyu/GALS-milestone-1-monorepo/apps/pyfeat-worker/processor.py)
- [apps/pyfeat-worker/db.py](d:/kianyu/GALS-milestone-1-monorepo/apps/pyfeat-worker/db.py)

Things to be careful with:

- keep all numeric sanitization
- do not assume source video FPS metadata is trustworthy
- if you add new output columns, update both DB insertion and CSV export paths

### If you want to continue export/analysis work

Start with:

- [analysis/export_logs.py](d:/kianyu/GALS-milestone-1-monorepo/analysis/export_logs.py)
- [analysis/multimodal_sync.py](d:/kianyu/GALS-milestone-1-monorepo/analysis/multimodal_sync.py)
- [analysis/backup_all_sessions.py](d:/kianyu/GALS-milestone-1-monorepo/analysis/backup_all_sessions.py)

Things to be careful with:

- table names are hard-coded in several places
- some queries special-case tables like `student_sessions`
- aligned exports depend on sync anchors and recording segment quality

## 13. Setup notes for a collaborator

To run this repo with the custom replay schema, make sure the collaborator does the usual setup and also applies Prisma migrations:

```bash
pnpm install
pnpm infra:up
pnpm db:migrate
pnpm dev
```

If they also need the analysis pipeline:

```bash
pip install -r analysis/requirements-analysis.txt
```

If they touch the py-feat worker, they should also use:

```bash
pip install -r apps/pyfeat-worker/requirements.txt
```

## 14. Suggested next tasks

These are the most natural continuation points:

1. Add explicit tests for replay pagination and snapshot lazy loading.
2. Add tests or sample fixtures for sessions with missing screenshot data.
3. Document how screen-capture permission affects replay quality for end users.
4. Decide whether replay snapshots should be pruned, compressed, or archived for very long sessions.
5. If analysis is a major workflow, consider documenting the export folder format and MinIO bucket layout in its own README.

## 15. Assumptions behind this note

This write-up is based on the current repo state and the post-import commits in this branch.

I am assuming:

- "Prism" in conversation meant Prisma/PostgreSQL persistence.
- the replay feature and the analysis pipeline are the main custom additions your collaborator needs to understand first.

If needed, this file can be split later into:

- `docs/replay-handoff.md`
- `docs/analysis-pipeline.md`
- `docs/pyfeat-notes.md`

For now, keeping them together should make onboarding easier for the next person.
