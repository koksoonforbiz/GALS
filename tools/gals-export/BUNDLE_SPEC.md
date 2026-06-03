# GALS Session Bundle Format — Version 1

A **bundle** is a self-contained, file-based export of a single instrumented
student learning session. After export it has **no Postgres or MinIO
dependency**: every byte the analysis app (GALS Studio) needs is on disk.

A bundle is a folder named `session_<sessionId>/`, optionally zipped to
`session_<sessionId>.zip`. All timestamps in a bundle are **wall-clock
milliseconds** (a normal JS `number`; ms fits safely in a double, so BigInt
DB columns are converted to numbers on export). The single time anchor is
`baseWallClockMs` (see below); relative time for any record is
`record.wallMs - baseWallClockMs`.

```
session_<sessionId>/
  manifest.json
  session.json
  streams/
    webgazer.jsonl      pupil.jsonl        emotion_frames.jsonl
    au_results.jsonl    clicks.jsonl       scrolls.jsonl
    cursors.jsonl       keystrokes.jsonl   clipboard.jsonl
    visibility.jsonl    viewport.jsonl     activity.jsonl
  snapshots/
    index.json
    <snapshotId>.html
    <snapshotId>.jpg        (only when a screenshot exists)
  webcam/
    index.json
    <segmentId>.mp4         (extension matches the stored mime; usually .webm)
  messages/
    chatbot.jsonl  dialogue.jsonl  interventions.jsonl  ef_detections.jsonl
  kc/
    mastery.jsonl  cards.jsonl  attempts.jsonl
  probes/
    probes.jsonl            (optional; file omitted when no probe data)
  questionnaires/
    questionnaires.jsonl    (optional; v1.1+; file omitted when none)
  annotations/
    annotations.jsonl  codes.jsonl   (optional; pre-existing labels to carry over)
```

## The time anchor — `baseWallClockMs`

`baseWallClockMs` is the **earliest** of:

1. the `session_sync_anchors.wallClockMs` for the session (if present),
2. the first replay snapshot's `capturedAt`,
3. `student_sessions.startedAt` (epoch ms).

This is the same anchor the live ReplayTab uses so replay in Studio lands at
the same `t = 0`. `durationMs` is `max(endWallMs across all streams) -
baseWallClockMs`, falling back to `student_sessions.durationSecs * 1000` and
finally to `0`.

## `manifest.json`

```jsonc
{
  "bundleVersion": 1,
  "exporterVersion": "1.0.0",
  "exportedAt": "2026-06-03T12:00:00.000Z",   // ISO; the only field allowed to differ between reruns
  "sessionId": "…",
  "userId": "…",
  "courseId": "…",
  "moduleId": "…",                            // optional
  "timezone": "Asia/Kuala_Lumpur",
  "baseWallClockMs": 1717400000000,
  "durationMs": 1830000,
  "counts": {                                 // row count per stream / file
    "webgazer": 64213, "pupil": 0, "emotion_frames": 1820,
    "au_results": 1820, "clicks": 142, "scrolls": 88, "cursors": 65000,
    "keystrokes": 12, "clipboard": 3, "visibility": 9, "viewport": 4,
    "activity": 230, "snapshots": 410, "webcam": 31, "chatbot": 44,
    "dialogue": 0, "interventions": 6, "ef_detections": 18,
    "mastery": 9, "cards": 9, "attempts": 21, "probes": 0,
    "questionnaires": 0, "annotations": 0, "codes": 0
  },
  "files": {                                  // relative path -> integrity
    "session.json": { "sha256": "…", "byteSize": 4096 },
    "streams/webgazer.jsonl": { "sha256": "…", "byteSize": 9123344 },
    "snapshots/<id>.html": { "sha256": "…", "byteSize": 21000 }
    // … every written file except manifest.json itself
  },
  "notes": ["webcam segment seg_7 missing in blob storage — recorded as status:missing"]
}
```

- `files` is computed over every written file **except** `manifest.json`
  (a file can't checksum itself). Importers verify each entry.
- `counts` lets the importer flag truncated streams (row count vs `counts`).

## `session.json`

The `student_sessions` row + the `session_sync_anchors` row + minimal
display-only course/module/user context. **Never** includes credentials, API
keys, email, password, or IP. Shape:

```jsonc
{
  "session": { "id", "userId", "courseId", "moduleId?", "startedAt", "endedAt?",
               "durationSecs?", "userAgent?", "device?" },
  "syncAnchor": { "wallClockMs", "monotonicMs", "serverReceiveMs", "timezone", "userAgent" } | null,
  "context": { "userDisplayName?", "courseTitle?", "moduleTitle?" }
}
```

## Streams (`streams/*.jsonl`)

JSONL: one JSON object per line. **Every record carries an absolute `wallMs`**
(number, wall-clock ms) plus the stream's native fields. BigInt DB timestamps
are converted to numbers; `Timestamptz` columns are converted to epoch ms.

| file | source table | `wallMs` derivation | native fields |
|------|-------------|---------------------|---------------|
| `webgazer.jsonl` | `webgazer_logs` | `timestamp` (Timestamptz → ms) | `x`(=gazeX), `y`(=gazeY), `confidence`, `pageUrl` |
| `pupil.jsonl` | `pupil_size_logs` | `timestamp` → ms | `diameter`(=pupilDiameter) |
| `emotion_frames.jsonl` | `emotion_frames` | `frameWallMs` (BigInt → num) | `faceDetected`, `dominant`(=dominantEmotion), `dominantProbability`, 8 probs `pHappiness…pNeutral`, head pose |
| `au_results.jsonl` | `pyfeat_au_results` | `wallTime` → ms | `frameIndex`, `faceConf`, `au01…au45` intensities |
| `clicks.jsonl` | `click_logs` | `timestamp` (BigInt → num) | `x`, `y`, `target`(=elementSelector), `text`(=elementText), `pageUrl` |
| `scrolls.jsonl` | `scroll_logs` | `timestamp` → num | `scrollY`, `scrollPercent`, `pageUrl` |
| `cursors.jsonl` | `cursor_logs` | `timestamp` → num | `x`, `y`, `target`(=elementTarget), `pageUrl` |
| `keystrokes.jsonl` | `keystroke_logs` | `timestamp` → num | `fieldId`, `keystrokeCount`, `pauseDurationMs`, `typingSpeedWPM` |
| `clipboard.jsonl` | `clipboard_logs` | `timestamp` → num | `action`, `textLength`, `sourceElement`, `pageUrl` |
| `visibility.jsonl` | `visibility_logs` | `timestamp` → num | `visibleState`, `hiddenDurationMs`, `pageUrl` |
| `viewport.jsonl` | `viewport_logs` | `timestamp` → num | `width`, `height`, `orientation` |
| `activity.jsonl` | `activity_logs` | `occurredAt` → ms | `action`, `metadata`, `moduleId?`, `moduleItemId?`, `interventionId?`, `dialogueSessionId?`, … |

> **Note on AUs:** the live DB stores a subset of AU columns
> (`au01,au02,au04…au28`). The bundle writes whichever AU columns are present
> as an `au<NN>` keyed map; absent AUs are simply not emitted for that row.

## `snapshots/`

`index.json` is an array **ordered by `capturedAt`**:

```jsonc
[{ "snapshotId", "wallMs", "trigger", "pageUrl", "width", "height",
   "scrollX", "scrollY", "aois", "scrollHosts",
   "pdfCurrentPage", "pdfTotalPages",
   "htmlFile": "<snapshotId>.html", "screenshotFile": "<snapshotId>.jpg" }]
```

- The DOM `html` is written to `<snapshotId>.html` **verbatim** (the recorder
  already stripped `<script>` and injected `<base href>` — kept as-is).
- `screenshotDataUrl` (`data:image/jpeg;base64,…`) is decoded to
  `<snapshotId>.jpg`. `screenshotFile` is omitted when no screenshot exists.
- `aois`: `[{ region, x, y, width, height }]` viewport-relative px (may be null).
- `scrollHosts`: `[{ region?, scrollTop, scrollHeight, clientHeight }]` (may be
  null). **Reading progress is derived from `scrollHosts` / `pdfCurrentPage`,
  never from window `scrollY`** (pinned near 0 in the docked layout).

## `webcam/`

`index.json` is an array:

```jsonc
[{ "segmentId", "startWallMs", "endWallMs", "file": "<segmentId>.mp4",
   "byteSize", "status": "ok" | "missing", "mimeType", "durationMs" }]
```

- Each segment's MP4/WebM blob is pulled from MinIO via `recording_segments.minioKey`
  and written to `<segmentId>.<ext>` (ext from `mimeType`; live platform records
  WebM, so usually `.webm`).
- **Time alignment:** `startWallMs = recording_segments.startWallTime` (epoch ms).
  `endWallMs = endWallTime` if present, else `startWallMs + durationMs`. The
  analysis app seeks the `<video>` to `currentAbsoluteMs - startWallMs`.
- If a segment is **missing/failed** in MinIO, it is recorded with
  `status:"missing"`, no file is written, and **export does not abort**.

## `messages/`

- `chatbot.jsonl` ← `chatbot_messages`: `wallMs`(=createdAt), `role`, `content`,
  `contextSource`, `selectedText`, `suggestedStrategy`, `model`, `moduleItemId`.
- `dialogue.jsonl` ← `dialogue_messages` (student time-window join):
  `wallMs`(=createdAt), `role`, `content`, `dialogueSessionId`.
- `interventions.jsonl` ← `learning_interventions` referenced by this session's
  activity logs: `wallMs`(=createdAt), `id`, `type`, `status`, `selectedText`,
  `sessionData`, `completedAt`, `pageType`, `contentId`, `courseId`.
- `ef_detections.jsonl` ← `ef_detections`: `wallMs`(=createdAt), `messageId`,
  `construct`(=constructKey), `label`, `confidence`, `severity`, `rationale`.

## `kc/`

- `mastery.jsonl` ← `user_mastery`, `cards.jsonl` ← `spaced_repetition_cards`,
  `attempts.jsonl` ← `attempts` for the user (+ course where applicable).
  Each carries a `wallMs` (best-effort from the row's most relevant timestamp).

## `probes/` and `questionnaires/` (optional)

- `probes/probes.jsonl` ← `probe_responses` (if the table/feature exists):
  `wallMs`(=`shownTs` ?? `ts`), `probeType`, `items`, `latencyMs`,
  `scheduledWallMs`, `shownWallMs`, `completed`. File omitted when no rows.
- `questionnaires/questionnaires.jsonl` (v1.1+, backward-compatible):
  `instrument`, `phase` (pre|post|enrollment), `items`, `scoredSubscales`,
  `completedAt`. File omitted when no rows.

## `annotations/` (optional, carried-over reference labels)

- `annotations.jsonl` ← `replay_annotations`: `id`, `startMs`, `endMs?`, `note`,
  `codeId?`, `researcherId`, `createdAt`.
- `codes.jsonl` ← `replay_codes`: `id`, `label`, `color`, `researcherId`.

These are **reference only**. GALS Studio imports them into a separate
`CarriedAnnotation` table and never lets them overwrite coder-produced labels.

## Integrity & idempotency rules

- Every written file (except `manifest.json`) appears in `manifest.files` with
  a sha256 and byte size. Importers verify both.
- Re-running the exporter with `--force` reproduces a **byte-identical** bundle
  (same checksums) except for `manifest.exportedAt`.
- A failure fetching one stream logs a warning and writes an **empty** file
  (`counts` records `0`) rather than aborting the whole export.
- No `signals.csv` is emitted: the wide-format binning lives in a web module
  that can't be imported server-side. GALS Studio derives its own binning from
  the raw streams, so duplicating that logic here is intentionally avoided.
