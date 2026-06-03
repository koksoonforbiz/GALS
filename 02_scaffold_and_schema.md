# Stage 02 — Scaffold GALS Studio + Schema + Bundle Importer

**Run this in a fresh repo** (`gals-studio/`). You will scaffold the offline
analysis app, define the SQLite schema, build the importer that loads session
bundles (format defined in stage 01), and ship a **Library** page listing
imported sessions. No replay UI yet.

---

## Context

GALS Studio is an offline, single-machine research app for replaying and coding
instrumented learning sessions. It imports **session bundles** (folders or zips)
produced by the stage-01 exporter and stores them in local SQLite + on-disk
media. Stack: npm-workspaces monorepo, React 18 + Vite + TS + Tailwind frontend
(`apps/studio-web`), Fastify + TS backend (`apps/studio-server`), Prisma +
SQLite, shared package (`packages/shared`). Everything runs on `localhost`. See
`00_OVERVIEW.md` for full context and repo layout.

Bundle layout recap (stage 01): `manifest.json`, `session.json`,
`streams/*.jsonl`, `snapshots/index.json` + `<id>.html`/`<id>.jpg`,
`webcam/index.json` + `<id>.mp4`, `messages/*.jsonl`, `kc/*.jsonl`, optional
`probes/probes.jsonl` and `annotations/*.jsonl`. All timestamps are wall-clock
ms.

---

## Task 1 — Scaffold the monorepo

- Root `package.json` with npm workspaces (`apps/*`, `packages/*`) and scripts:
  `dev` (run server + web concurrently), `studio` (production-ish single command:
  build web, start server, open browser to `localhost`), `db:migrate`,
  `db:studio` (Prisma Studio), `test`.
- `packages/shared`: TypeScript types for every bundle record, **zod** validators
  for `manifest.json` / `session.json` / each JSONL record, and a
  `validateBundle(dir)` function. Re-export the bundle spec constants
  (`BUNDLE_VERSION = 1`, file names). Stub `analysis/` and `codebook/` dirs (filled
  in stages 04–05).
- `apps/studio-server`: Fastify app, Prisma client, a configurable
  `STUDIO_DATA_DIR` (default `~/.gals-studio`) holding `studio.db` and a
  `media/` tree. Health route `GET /api/health`.
- `apps/studio-web`: Vite + React + Tailwind + React Router. Routes: `/`
  (Library), `/replay/:sessionId`, `/coding/:sessionId`, `/analysis` (stub
  pages for the latter three — real builds come in stages 03–05). A typed API
  client in `src/lib/api.ts`.

## Task 2 — Prisma schema (SQLite)

Create `apps/studio-server/prisma/schema.prisma`. Use additive migrations.
Media stays on disk; DB stores **relative paths** under `STUDIO_DATA_DIR/media/`.

**Ingested data (mirrors bundle):**

- `Session` — `id`, `userId`, `courseId`, `moduleId?`, `startedAt`, `endedAt?`,
  `durationMs`, `timezone`, `baseWallClockMs`, `device?`, `bundleVersion`,
  `importedAt`, `manifest` (JSON), `mediaDir` (relative path). Display-name
  fields only; never store credentials.
- High-frequency streams as their own tables, each with `sessionId`, `wallMs`,
  and native fields: `GazeSample`, `PupilSample`, `EmotionFrame` (8-class probs +
  `dominant`), `AuResult` (au01..au45 as a JSON map to keep columns sane),
  `Click`, `Scroll` (store `scrollHosts` JSON), `Cursor`, `Keystroke`,
  `Clipboard`, `Visibility`, `Viewport`, `ActivityEvent` (`action`, `metadata`
  JSON, plus optional `interventionId`, `dialogueSessionId`, `moduleItemId`).
- `Snapshot` — `id`, `sessionId`, `wallMs`, `trigger`, `pageUrl`, `width`,
  `height`, `scrollX`, `scrollY`, `aois` JSON, `scrollHosts` JSON,
  `pdfCurrentPage?`, `pdfTotalPages?`, `htmlPath`, `screenshotPath?`.
- `WebcamSegment` — `id`, `sessionId`, `startWallMs`, `endWallMs?`, `mp4Path`,
  `byteSize`, `status`.
- `ChatbotMessage`, `DialogueMessage`, `Intervention` (`type`, `status`,
  `sessionData` JSON, `selectedText?`), `EfDetection` (`construct`, `label`,
  `confidence`, `severity`, `rationale?`, `model?`, `wallMs`, source ref).
- `Mastery`, `SpacedRepCard`, `Attempt`, `ProbeResponse` (`probeType`, `items`
  JSON, `latencyMs?`, `scheduledWallMs?`, `shownWallMs?`, `wallMs`).

**Coding/analysis tables (created now, used in stages 04–05):**

- `Coder` — `id`, `name`, `role` (`trained_rater`|`tiebreaker`|`teacher`|`expert`),
  `createdAt`.
- `CodebookVersion` — `id`, `name`, `version`, `definition` JSON (the hierarchical
  codebook), `locked` bool, `createdAt`. Seed one default version (stage 04
  provides the canonical codebook; for now seed an empty/placeholder you can
  replace).
- `CodingWindow` — `id` (deterministic `${sessionId}:${index}`), `sessionId`,
  `index`, `startWallMs`, `endWallMs`, `durationMs` (default 20000).
- `Annotation` — `id`, `sessionId`, `windowId?` (null = point/range annotation),
  `coderId`, `codingPass` (`primary_rater_1`|`primary_rater_2`|`tiebreaker`|
  `gold_consensus`), `codebookVersionId`, `dimension`
  (`affect`|`behavior`|`ef_event`|`motivation`), `code`, `intensity?`,
  `confidence?`, `atWallMs?` (point), `startWallMs?`/`endWallMs?` (range),
  `notes?`, `createdAt`, `updatedAt`. Index on
  `(sessionId, windowId, coderId, codingPass, dimension)`.
- `CarriedAnnotation` — raw copy of any `annotations.jsonl` from the bundle, kept
  separate from coder-produced `Annotation` so imported labels never overwrite
  new coding. (Researchers can promote them later.)
- `ReliabilityRun` — `id`, `scope` (sessionId or `all`), `dimension`, `metrics`
  JSON, `params` JSON, `computedAt`.

**Durability rule:** importing a bundle must **never** delete or modify
`Coder`, `Annotation`, `CodebookVersion`, or `ReliabilityRun` rows. Re-importing
the same `sessionId` refreshes ingested streams/media only.

## Task 3 — Bundle importer

In `apps/studio-server/src/import/`:

- `POST /api/import` accepting either an absolute path to a bundle folder/zip on
  the local machine, or a multipart upload of a zip. Also a CLI:
  `studio-import <path-or-glob>` for bulk import of many bundles at once.
- Steps: unzip if needed → `validateBundle()` (zod) → verify `manifest.files`
  checksums → copy media (`snapshots/*.html|jpg`, `webcam/*.mp4`) into
  `STUDIO_DATA_DIR/media/<sessionId>/` → bulk-insert streams in batches
  (transactioned, e.g. 1–5k rows per insert) → compute `CodingWindow` rows by
  segmenting `[baseWallClockMs, baseWallClockMs + durationMs)` into 20 000 ms
  windows (last window may be short; keep deterministic ids).
- **Idempotent:** re-importing a `sessionId` deletes only that session's
  ingested stream/media rows and reinserts; coding tables untouched. Use a DB
  transaction; on any failure roll back that session's ingest and report which
  file/row failed (don't poison other sessions in a bulk run).
- Validation surfaces a per-bundle report: row counts vs `manifest.counts`,
  missing webcam segments, checksum mismatches, parse errors. Mismatches warn
  but still import what's valid.

## Task 4 — Media serving

- `GET /api/media/snapshot/:sessionId/:snapshotId.html` and `.jpg`, and
  `GET /api/media/webcam/:sessionId/:segmentId.mp4` with HTTP **range request
  support** (needed for video scrubbing). Serve only from
  `STUDIO_DATA_DIR/media/` (path-traversal guard).

## Task 5 — Library page

`apps/studio-web/src/pages/Library.tsx`:

- Table of imported sessions: student/user, course, date, duration, counts
  (snapshots / gaze / emotion / webcam segments / messages), and a **coding
  status** column (windows total, % coded by rater 1, by rater 2, disagreements
  pending — these can read `Annotation` even though coding UI ships in stage 04).
- "Import bundle…" button (folder picker / drag-drop zip → `POST /api/import`),
  with progress and the validation report.
- Row actions: **Open Replay**, **Open Coding**, **Re-import**, **Delete**
  (delete asks whether to also delete coding for that session; default **no**).
- Filters: by course, by coder progress, by whether webcam exists.

## Acceptance checks

- `npm run dev` brings up server + web; `/api/health` returns ok.
- Importing a stage-01 sample bundle populates the DB, copies media, and creates
  the right number of 20 s windows (`ceil(durationMs / 20000)`).
- Re-importing the same session does not change `Annotation`/`Coder` rows
  (add a test: seed an annotation, re-import, assert it survives).
- A snapshot HTML and a webcam MP4 are fetchable via the media routes, and the
  MP4 honors `Range` requests.
- Library lists the session with correct counts and coding status.
