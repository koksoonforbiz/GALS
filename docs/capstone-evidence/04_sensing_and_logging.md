# 04 — Sensing & Instrumentation Layer

> **Basis:** Read from source on `claude/capstone-evidence-pack-h737h5`, including the two Python workers (`apps/pyfeat-worker`, `apps/openface3-worker`). Every model attribution below is backed by the worker inference code, not by docs. Where a doc/CSV label contradicts the code, the code wins and it is flagged.

---

## 1. Eye gaze — WebGazer

- **Library:** WebGazer.js, loaded via a `<script src="/webgazer.js">` tag from `apps/web/public/webgazer.js` (not npm) — `apps/web/src/lib/webgazer/useWebgazer.ts:27-37`. Config: `setRegression('weightedRidge')`, `saveDataAcrossSessions(false)`, MediaPipe face_mesh WASM (`:209-222`). Its MediaStream is registered under key `'webgazer'` in a shared `mediaStreamRegistry` (`:234-236`) — this is the camera the pupil estimator borrows.
- **Sampling rate:** gaze listener **throttled to 10 Hz** (`if (now - last < 100) return`, `:262-267`).
- **Per-sample stored (`WebgazerLog`, `schema.prisma:1808-1826`):** `gazeX`, `gazeY` (Float), `confidence` (Float?, passed through untouched — `data.confidence ?? null`), `pageUrl`, `timestamp`.
- **Batching:** dual trigger — flush at **300 buffered readings** OR every **30 s** (`:279-281, 295`); synchronous `keepalive` fetch on unmount/logout/`beforeunload`.
- **Calibration flow:** `calibrationOnNewSession` flags calibration on start; an inactivity timer (`inactivityTimeoutSecs`; schema default 1800 but the service seeds new rows with **300** — `webgazer.service.ts:24`) re-flags calibration if `recalibrationEnabled`; `trainOnPoint` feeds known click points. Calibration events → `WebgazerCalibrationEvent` (`triggeredBy`, `accuracy`).
- **Confidence use:** stored raw; later used as a quality filter in AOI scoring (`confidenceFloor = 0.5`, §5).

---

## 2. Facial analysis — the MP4 → worker pipeline (**definitive model attribution**)

> **This resolves the doc contradiction.** The schema already ties `emotion_frames` → `Openface3Job` and `pyfeat_au_results` → `PyfeatJob`; reading both workers' inference code confirms it and pinpoints the *source* of the confusion.

Recording flow: `RecordingService.completeSegment` enqueues jobs when the respective config is enabled (`recording.service.ts:178-187`) → Redis lists `openface3:jobs` / `pyfeat:jobs` → the two Python workers `blpop` and process.

### 2.1 8-class emotion probabilities → **OpenFace 3.0** (real inference)

`apps/openface3-worker/inference.py`. It loads CMU OpenFace 3.0 weights at boot (`Alignment_RetinaFace.pth` detector + `MTL_backbone.pth` multitask head, `:71-89`) and **fails fast if weights are missing** — no placeholder/random data. Per frame (`:104, 120-135`):
```python
emotion_logits, _gaze, _au = self.multitask_model.predict(cropped)   # line 104
probs = F.softmax(logits, dim=0).tolist()                            # line 120
```
Fixed AffectNet 8-class order (`:35-44`): `neutral, happiness, sadness, surprise, fear, disgust, anger, contempt`. Persisted to `emotion_frames` via `insert_emotion_frames` (`main.py:152-191`, batched `page_size=200`) → columns `p_happiness…p_neutral`, `dominant_emotion`, `dominant_probability` (`schema.prisma:2274-2310`).

### 2.2 18 AU intensities → **Py-Feat** (real inference)

`apps/pyfeat-worker/processor.py`. Uses `feat.Detector(face_model=retinaface, au_model=xgb, emotion_model=resmasknet)` (`:122-129`) and `detector.detect_image(frame_paths)`. **The 18 AUs written** (`:22-26`, DB columns): **au01, au02, au04, au05, au06, au07, au09, au10, au12, au14, au15, au17, au20, au23, au24, au25, au26, au28**. Persisted to `pyfeat_au_results` (`db.py:46-98`) with `face_conf`, `face_box`, `wall_time`, `timestamp`, `frame_index`.

> Note: py-feat's Detector *does* load an emotion model (`resmasknet`), but the worker **never reads or persists any emotion column** — it extracts only the 18 AUs. **Py-feat contributes nothing to `emotion_frames`.**

### 2.3 Head pose (yaw/pitch/roll) → **NULL, never computed**

The `emotion_frames` table has `head_pose_yaw/pitch/roll` columns (`schema.prisma:2299-2301`), but the OpenFace3 worker **hard-codes them NULL** on insert (`main.py:169, 176`). The multitask model returns a gaze tensor but the worker **discards it** (`_gaze` is thrown away, `inference.py:104`); `FrameResult` has no pose fields. Py-feat computes no pose either. **Head pose is a schema placeholder, always NULL — disclose this plainly.**

### 2.4 FPS per worker

| Worker | Config default | Runtime | Cite |
|---|---|---|---|
| Py-Feat | `PyfeatConfig.extractionFps` **1.0** | `job.get("extractionFps",1.0)` clamped [0.1,30] | `schema.prisma:1852`, `processor.py:75` |
| OpenFace3 | `RecordingConfig.openface3ExtractionFps` **5**; `Openface3Job.extractionFps` **5** | `float(job.get('extractionFps',5))` | `schema.prisma:1710, 2256`, `main.py:206` |

### 2.5 Attribution summary

| Output | Library / worker | Real inference? | DB table | Columns |
|---|---|---|---|---|
| 8-class emotion + dominant | **OpenFace 3.0** (MTL_backbone.pth) | ✅ | `emotion_frames` | `p_happiness…p_neutral`, `dominant_emotion`, `dominant_probability` |
| 18 AU intensities | **Py-Feat** (`feat.Detector`, xgb) | ✅ | `pyfeat_au_results` | `au01…au28`, `face_conf`, `face_box` |
| Head pose | none | ❌ NULL | `emotion_frames` (cols exist) | `head_pose_*` = NULL always |

> **⚠ Source of the doc contradiction (found):** the replay CSV exporter mislabels the emotion source. `exportReplayCsv.ts:392` emits `emotion_dominant_label` with unit string **`'string (py-feat)'`**, while its 8 probability rows come from `EmotionFrame` (OpenFace3). **The data is OpenFace3; only the CSV header string wrongly says py-feat.** Fix the label in any figure caption.

---

## 3. Pupil size

> **Honest verdict: not a stub, but not real pupillometry either — a crude webcam dark-pixel-area heuristic.** Real webcam pixels, low validity.

Capture (`apps/web/src/lib/pupil-size/usePupilSize.ts`): does **not** open its own camera — it borrows the webgazer/recording MediaStream from `mediaStreamRegistry` (`:152-173`), draws frames to a hidden 320×240 canvas. **Sampling 2 Hz** (`setInterval(…,500)`). Estimation (`:57-104`): grayscale → fixed centre ROI (x 20–80%, y 15–55% of frame, **not** eye-localised) → adaptive threshold `max(mean−30, 20)` → count dark pixels → `diameter = 2·√(darkPixels/π)`. This conflates hair/shadow/brows with pupil. Stored to `PupilSizeLog.pupilDiameter` (unit "px"); `rawData` is never sent (always null). Batching: 30 s + keepalive.

**For the viva:** describe pupil diameter as a **proxy dark-area signal**, not calibrated pupillometry, and treat any pupil-derived cognitive-load claim with caution.

---

## 4. Affective-state derivation (Wickens-derived rollups)

> **⚠ There are TWO separate derivations — do not conflate them.**

### 4.1 Server-side, window-based (the persisted pipeline)

Engine: `apps/api/src/affective-mapping/mapping-engine.service.ts`. Config `AffectiveMappingConfig` (`schema.prisma:2314-2331`): `windowSeconds` default **30**, `strideSeconds` default **10**, `minFramesPerWindow` default **5**, plus `rules` (JSON) and `version`.

- **Windowing / late fusion** (`affective-mapping.service.ts:198-232`; engine `:103-116`): sliding window `[wStart, wStart+windowMs)` stepped by stride; fusion is **mean-pooling of the 8 OpenFace3 emotion probabilities over face-detected frames**, gated by `if (faceFrames.length < minFramesPerWindow) return null`. No gaze/pupil/AU enter this layer.
- **Rule evaluation** (engine `:45-84`): each of the four states combines weighted emotion terms via a `combinator` ∈ `weighted_sum | disjunctive(max) | conjunctive(min) | product`, with optional `lowArousalModifier`, `threshold`, `clamp01`.
- **`dominantState`** (`:123-131`): argmax over `[engagement, boredom, confusion, frustration]`, initialised to `'none'` with `maxScore=0` (so all-zero → `'none'`).
- **Persisted to `affective_state_windows`** (`schema.prisma:2350-2382`): the four scores + `dominantState` + `mean*` emotions per window.

**Default rule set (Wickens-derived)** — `packages/shared/src/affective-mapping.ts:37-84`, seeded into `rules` on first config:
```
engagement  : weighted_sum { pNeutral 0.45, pHappiness 0.35, pSurprise 0.20 }              clamp01
frustration : disjunctive  max( pDisgust, pAnger, max(pSadness,pContempt) )                clamp01
confusion   : conjunctive  min( pAnger, pDisgust, max(pSurprise,pFear) )                   clamp01
boredom     : weighted_sum { pNeutral 0.55, pSadness 0.30, pDisgust 0.15 }  ×(1 − max(pSurprise,pHappiness,pAnger,pFear))   clamp01
```

### 4.2 Client-side, per-frame threshold classifier (the Replay slider path)

A **different, hard-coded** classifier used only in the browser Replay tab + CSV export; it does **not** touch `AffectiveMappingConfig`, the 30 s/10 s windows, or `affective_state_windows`.

Thresholds (`ReplayTab.tsx:554-564`, mirror in `exportReplayCsv.ts:96-106`):
```
engagement 0.14, boredom 0.20,
confusion_surprise 0.0, confusion_fear 0.05, confusion_anger 0.19, confusion_disgust 0.0,
frustration_sad 0.20, frustration_anger 0.25, frustration_disgust 0.13
```
Per-frame formulas (`ReplayTab.tsx:638-639`):
```
engagement = 0.4·happy + 0.4·neutral + 0.2·surprise      (continuous)
boredom    = 0.5·neutral + 0.3·sad + 0.2·disgust         (continuous)
confusion  = 1 iff surprise>t ∧ fear>t ∧ anger>t ∧ disgust>t   (binary flag)
frustration= 1 iff sad>t ∨ anger>t ∨ disgust>t                (binary flag)
```

**How the Replay slider interacts:** it **does not touch the server windows.** The sliders mutate React `learningThresholds`, which drives (a) the live per-frame overlay and (b) the CSV export's affective rows — both computed **per emotion frame at the nearest sample per bin**, independent of `windowSeconds/strideSeconds/minFramesPerWindow`. Dragging the slider re-labels the client timeline/export only; it never recomputes `affective_state_windows`.

> **⚠ Inconsistency to disclose:** the server and client use **different engagement/boredom weights** (server `0.45/0.35/0.20` & `0.55/0.30/0.15`; client `0.4/0.4/0.2` & `0.5/0.3/0.2`). Be explicit about which pipeline any figure comes from.

---

## 5. AOI / attention layer

### 5.1 Capturing `data-replay-region` rects

`apps/web/src/lib/interaction-log/useSessionReplayRecorder.ts:152-174` (`captureAois`): `querySelectorAll('[data-replay-region]')`, read the region label + `getBoundingClientRect()`, push `{region, x, y, width, height}` in **viewport-relative pixels**. Zero width/height is preserved on purpose ("panel hidden now"). Region labels: `sidebar, lesson, pdf-viewer, chatbot, header` (`aoiScoring.ts:23-36`). Stored per snapshot in `SessionReplaySnapshot.aois` JSONB (`schema.prisma:2384-2403`).

### 5.2 Coverage algorithm, epochs, and the exact `allocation_score`

Kernel: `apps/web/src/pages/teacher/student-logs/lib/aoiScoring.ts` (`computeAoiScoring`, `:425-646`) — a pure gaze×snapshot two-pointer walk.

- **Valid-study mask** (`:58-62`): `confidenceFloor 0.5`, `transitionSettleMs 750`, `idleGapMs 10 000`. A gaze sample is dropped if out of window, `confidence < 0.5`, tab hidden/blurred, inside a nav/click transition-settle interval, or inside an `idle` epoch (`:503-531`).
- **Bucket assignment** (`pickBucketForGaze`, `:184-209`): smaller-area rect wins when nested (`pdf-viewer ⊂ lesson`); `lesson` + `pdf-viewer` roll up to bucket **`lesson+pdf`**; no hit → `outside`.
- **Epoch segmentation** (`segmentEpochs`, `:305-410`) — 5 `EpochType`s: `reading_lesson, intervention_active, chatbot_dialogue, navigating_modules, idle`. Only `reading_lesson`, `intervention_active`, `chatbot_dialogue` are **scored**.
- **Expected weights (SEEV/EV, ordinal, normalised per row)** (`DEFAULT_EXPECTED_WEIGHTS`, `:91-123`), e.g. `reading_lesson`: sidebar 1, lesson+pdf 3, chatbot 1, header 0 → normalised shares 0.2/0.6/0.2/0.
- **Per-AOI PDT (coverage):** `pdt = samples_in_bucket / total_valid_samples` (`:566-581`); per-epoch observed share = `buckets[b] / max(1, epoch.samples)`.

**Per-epoch alignment (exact, `:614-621`)** — a total-variation-distance similarity over the 4 scored buckets:
```
alignment = 1 − 0.5 · Σ_b | observed[b] − expected[b] |        for b ∈ {sidebar, lesson+pdf, chatbot, header}
```
Range [0,1]; `null` for idle/nav/zero-valid-sample/zero-weight epochs.

**Session `allocation_score` (exact, `:635-643`)** — duration-weighted mean of scored-epoch alignments:
```
sessionAlignment = Σ(epoch.alignment · epoch.durationMs) / Σ(epoch.durationMs)     over epochs where alignment ≠ null
                 = null if total weight == 0
```
Surfaced as the CSV row `aoi_session_allocation_score` (constant across bins; unit "0-1, duration-weighted mean of epoch alignments", `exportReplayCsv.ts:1210-1216`).

> **⚠ Caveat:** the expected weights are documented as **placeholders** (`aoiScoring.ts:111`) meant to be tuned by the researcher. Report the allocation score as a *relative* attention-alignment index, and state that the SEEV/EV weights are assumed, not empirically fitted.

---

## 6. Full logging inventory

Client: `LoggingProvider.tsx` mounts `useInteractionLogger` (8 raw streams) + `useSessionReplayRecorder` (snapshots). **DOM capture defaults OFF** (`captureDom=false`, `LoggingProvider.tsx:19`) — pixel screenshots always captured.

Cadence constants (`useInteractionLogger.ts:5-8`, `useSessionReplayRecorder.ts:6-7`):
```
FLUSH_INTERVAL_MS   = 30_000   // buffered streams every 30 s
CURSOR_THROTTLE_MS  = 100      // ≤10 Hz
SCROLL_THROTTLE_MS  = 200      // ≤5 Hz
RESIZE_DEBOUNCE_MS  = 500
SNAPSHOT flush      = 10_000   // snapshot batches every 10 s
PERIODIC_SNAPSHOT   = 3_000    // one periodic snapshot every 3 s
```

| Table | Captured | Cadence |
|---|---|---|
| `cursor_logs` | `x,y`, `pageUrl`, coarse `elementTarget`, `batchId` | mousemove throttled 100 ms, flush 30 s |
| `click_logs` | `x,y`, `elementSelector`, `elementText` (**≤50 chars**) | every click, flush 30 s |
| `scroll_logs` | `scrollY`, `scrollPercent` | scroll throttled 200 ms, flush 30 s |
| `keystroke_logs` | `fieldId`, `keystrokeCount`, `pauseDurationMs`, `typingSpeedWPM` — **aggregates, not keys** | one row per field **on blur**, flush 30 s |
| `clipboard_logs` | `action`, `textLength`, `sourceElement` — **length only** | immediate POST |
| `visibility_logs` | `visibleState`, `hiddenDurationMs` | immediate POST on `visibilitychange` |
| `viewport_logs` | `width,height,orientation` | init + resize (debounced 500 ms) |
| `performance_logs` | `pageLoadMs,apiLatencyMs`, top-10 slowest resources | once per navigation |
| `error_logs` | `errorMessage`, `stack` (**≤2000 chars**), `errorType` | on error/unhandledrejection |
| `session_replay_snapshots` | `html?`, `screenshotDataUrl?`, geometry, `aois`, `scrollHosts`, pdf page | periodic 3 s + triggers, flush 10 s |
| `session_sync_anchors` | wall/monotonic/server clocks, tz, UA | upsert once at init |
| `activity_logs` | `action` (43-value enum), `occurredAt`, optional FKs, `metadata` JSON | fire-and-forget per event |

**`ActivityAction` full enum** (`activity-log/activity-action.enum.ts`): session (`SESSION_START/END/HEARTBEAT`), navigation (`MODULE_OPENED, MODULE_ITEM_VIEWED, KC_GRAPH_VIEWED`), assessment (`ASSESSMENT_STARTED, QUESTION_VIEWED, QUESTION_ANSWERED, ASSESSMENT_SUBMITTED, ASSESSMENT_GRADED`), dialogue/chatbot (`DIALOGUE_SESSION_STARTED, DIALOGUE_MESSAGE_SENT, DIALOGUE_MESSAGE_RECEIVED, DIALOGUE_SESSION_ENDED, CHATBOT_MESSAGE_SENT, CHATBOT_MESSAGE_RECEIVED`), interventions (`INTERVENTION_TRIGGERED, INTERVENTION_VIEWED, INTERVENTION_COMPLETED, INTERVENTION_DISMISSED, PRACTICE_TEST_CONFIGURED`), spaced rep (`SPACED_REP_CARD_VIEWED, SPACED_REP_CARD_RATED`), materials/studio (`STUDY_MATERIAL_UPLOADED, STUDY_GUIDE_GENERATED, STUDIO_OUTPUT_REQUESTED, STUDIO_OUTPUT_VIEWED`), learning state (`MASTERY_UPDATED, FEEDBACK_RECEIVED`), biometrics infra (`RECORDING_STARTED/STOPPED/SEGMENT_UPLOADED/UPLOAD_FAILED/RESUMED`, `PUPIL_SIZE_TRACKING_STARTED/STOPPED/BATCH_SUBMITTED`, `WEBGAZER_TRACKING_STARTED/STOPPED/CALIBRATION_STARTED/COMPLETED/SKIPPED/BATCH_SUBMITTED/RECALIBRATION_PROMPTED`, `PYFEAT_JOB_ENQUEUED/COMPLETED/FAILED`), and `EMOTION_SELF_REPORT`.

### Privacy posture (what is deliberately NOT captured — with proof)

- **No raw keystrokes** — only counts + WPM (`e.key` is never read; WPM = `count/5` words, `useInteractionLogger.ts:265-274`). Backend: *"the platform does not store individual key presses by design"* (`logs.service.ts:709-711`).
- **No clipboard text** — length only (`textLength`, `:331, 365`).
- **Passwords redacted** in any DOM snapshot (`[REDACTED]`, `useSessionReplayRecorder.ts:240-241`); file inputs store only a count.
- **Coarse element identifiers** (tag / tag#id / tag.firstClass); click text capped at 50 chars.
- **No audio** — webcam recorded 640×480 @ 15 fps, `audio:false`; screen-capture stream `audio:false`.

### Sync anchors (cross-modal alignment)

Captured once at session init (`useInteractionLogger.ts:137-149`): `wallClockMs = Date.now()`, `monotonicMs = performance.now()`, `timezone`, `userAgent`; server stamps `serverReceiveMs = Date.now()` and upserts one row per session (`logs.service.ts:358-390`). `serverReceiveMs − wallClockMs` = client↔server skew. The replay time base is `baseWallClockMs = syncAnchor.wallClockMs ?? snapshots[0].capturedAt ?? session.startedAt` (`ReplayTab.tsx:786-793`); every downstream coordinate (CSV `relative_s`, annotation `startMs/endMs`) is relative to it. All biometric streams join on wall-clock (`frameWallMs`, `wallTime`, gaze/pupil ISO `timestamp`). The `modality_offsets` table exists (`schema.prisma:2052`) but is **not populated** by the reviewed paths.

---

## 7. Session replay + retrospective coding

### 7.1 Replay tab capabilities & the 3-stage load

`tabs/ReplayTab.tsx` (3,753 lines), data hook `hooks/useSessionReplay.ts:450-489`:
1. **Stage 1** — metadata + all log/biometric streams, **no snapshots** (`?includeSnapshots=false`), returns `snapshotCount`.
2. **Stage 2** — paginated snapshot **metadata** (geometry, `aois`, `scrollHosts`, `trigger`, pdf anchors), cursor loop `?limit=120&includeContent=false` (backend clamps ≤200).
3. **Stage 3** — on-demand **full content** per current snapshot (`html` always, `screenshotDataUrl` on request), LRU cache of ≤12 hydrated snapshots.

**View reconstruction:** `html` rendered in a double-buffered sandboxed `<iframe srcDoc>` (cross-fade, no JS, `allow-same-origin`); injected `<base href=origin>`; `screenshotDataUrl` pixel thumbnail; `scrollHosts` + `data-replay-scroll-top/left` markers restore inner-container scroll; multi-pass scroll restore with a **PDF-page-anchor fallback** (because PDF canvases may still be decoding at `onLoad`) and a Pass-2 re-apply after each `<img>` decodes. **Pixel/DOM fallback:** with `captureDom=false` (the default) there is no HTML and the **pixel screenshot is the primary view**; tainted/cross-origin canvases are skipped and the screenshot path picks up the slack.

### 7.2 Retrospective coding schema & purge-survival

`ReplayCode` (`replay_codes`, `schema.prisma:2437-2455`): `researcherId` (→User Cascade), `label`, `color?` — **private to the creating researcher**. `ReplayAnnotation` (`replay_annotations`, `:2457-2488`): `sessionId` (→StudentSession **Cascade**), `researcherId` (→User Cascade), `codeId?` (→ReplayCode **SetNull**), `startMs`, `endMs?` (null → point annotation; ≥startMs → range), `note?`, in the same `baseWallClockMs` coordinate as CSV `relative_s`. UI: `AnnotationsPanel.tsx` + `useReplayAnnotations.ts` (non-optimistic POST-then-refetch), ownership-guarded (`replay-annotations.controller.ts`).

**Purge-survival behaviour (deleting a `StudentSession`):**
- **`ReplayAnnotation` → CASCADE** — annotations are deleted with the session. Codes themselves survive (researcher-owned).
- **`ChatbotMessage` → SetNull** — chatbot turns **outlive a session purge** (FK nulled, row kept); only deleted when the student is deleted (`schema.prisma:912-919`).
- Cascaded with the session: `ActivityLog`, `SessionReplaySnapshot`, `RecordingSegment`, `PyfeatJob`(→`PyfeatAuResult`), `EmotionFrame` (via `Openface3Job`), `SessionSummary`.
- **No scheduled purge job exists** — purge is DB-cascade-driven off session/user deletion, not a background sweep. (This is why the replay query re-unions chatbot messages by a student+time-window fallback rather than session id alone, `logs.service.ts:680-708`.)

### 7.3 CSV exporter — full column set + sampling strategy

Primary wide-format replay CSV: `lib/exportReplayCsv.ts`. **Transposed** layout: row 1 `wall_clock_iso`, row 2 `relative_s`, then one row per metric with a `unit` column; UTF-8 BOM for Excel. **Binning:** default `binMs = 1000` (drop to 200 ms to match py-feat cadence); nearest-sample window `1.5×binMs`. Three sampling regimes:
- **Time-aligned → nearest sample within ±window** (binary search): emotion label + 8 probabilities, affective label/scores/flags, 18 AUs, gaze x/y/confidence, pupil diameter.
- **Continuous → carry-forward:** `scroll_y`, viewport, snapshot trigger/URL, pdf page, per-panel AOI x/y/w/h, per-scroll-host `scroll_top_*`/`scroll_percent_*`, `aoi_active_regions`.
- **Sparse events → dropped into their bin:** cursor, keystroke aggregates, clipboard, visibility, click, all curated activity actions, practice-test config, chatbot & dialogue turns (truncated to 500 chars), EF detections, plus a catch-all `activity_other` row so no action is silently dropped.

Optional AOI rows: `aoi_epoch_type, aoi_epoch_alignment, aoi_pdt_observed/expected_*, aoi_session_allocation_score`. Backend cap feeding this: emotion & AU frames limited to `MAX_REPLAY_BIOMETRIC_FRAMES = 50000` (`logs.service.ts:45`).

**Other CSV surfaces:** (a) a full-session **ZIP** (`exportSessionData.ts`) with `session_data.json` + `recordings/*.webm` + screenshot frames (DOM snapshots deliberately excluded — too large); (b) a **7-CSV cohort ZIP** in the separate `gals-studio` server (`analysisSummary.ts:414-847`): `free-dialogue.csv`, `learning-strategy-utterances.csv`, `intervention-responses.csv`, `interventions.csv` (with time-spent), `self-report-survey.csv`, `ef-text-mining.csv`, `summary.csv` — all honouring the researcher's session-trim window; (c) a per-session EF `detections.csv` in the API (`text-mining.controller.ts:103-121`).

> **Note:** a second app tree `gals-studio/` (studio-server) exists and hosts the cohort multi-CSV export and additional research exporters (`long, gold, reliability, summary, probes, questionnaires`). It is a distinct surface from the main `apps/web` Replay tab.

---

## 8. Known data-quality caveats (disclose these in the viva)

> History caveat: much of the repo is squashed — several comment-described fixes actually landed inside one large squash commit `8638192` ("LLM provider upgrade + RAG multimodal + …", **2026-06-03**), so the granular "when fixed" is that squash date.

1. **Docked-layout window-scroll bug** — in the docked course layout, lesson MDX and the PDF reader scroll inside inner `overflow-y-auto` containers, so `window.scrollY` was a dead signal and the reading position was not captured. Fixed by the `scrollHosts`/`pdf_current_page` capture (migration `20260601010000`, landed in squash `8638192`, **2026-06-03**). **Affected:** every session recorded **before** that migration has `scroll_hosts = NULL` — inner reading position (lesson/PDF scroll, PDF page) is **unrecoverable**; replay opens inner containers at `scrollTop=0`. (Distinct from `da0292c` "long-session replay with paged snapshots + pixel/DOM fallback", **2026-05-20** — that is the paged-load fix, not the scroll fix.)
2. **Replay truncation of emotion/AU frames** — the replay endpoint capped `emotionFrame`/`pyfeatAuResult` at `take: 5000`; commit `64b3510` ("Fix replay truncation…", **2026-05-21 14:02 +0800**) raised it to 50000. **Affected:** at ~5 fps, 5000 frames ≈ **16.7 min** — any session **longer than ~17 min recorded before 2026-05-21** had its emotion/AU replay + CSV **silently truncated to the earliest 5000 frames** (the session tail shows no affect). Residual: even post-fix the 50000 cap (≈166 min) truncates extremely long sessions silently.
3. **Hex-escape / null-byte sanitization drops** — browser selectors/URLs can emit literal `\x` fragments that Postgres' JSON lexer rejects. Two-layer defense (`logs.service.ts:10-23, 102-115`): a sanitizer doubles malformed `\x` (no data lost), but if Postgres still rejects, **the whole batch is dropped and `{success:true, count:0, dropped:N}` returned** so the client buffer doesn't wedge. **Affected batches are lost, surfaced only as a server `logger.warn`** — downstream CSVs simply have gaps in those bins; no column records the loss. (Introduced in squash `8638192`.)
4. **PyfeatJob has no auto-retry and no `retries` column** (`schema.prisma:1862-1882`) — the worker marks a job `FAILED` on any exception (`pyfeat-worker/main.py:94-101`); retry is **manual only** (`pyfeat.service.ts:120-147`). The `retries` column exists only on **`Openface3Job`** (`schema.prisma:2261`) and increments **only on manual retry** (`openface3.service.ts:78-84`) — it counts human re-runs, not automatic backoff. A failed job shows as **missing biometric rows** for that segment with the error string available but no automatic recovery. There is no observable automatic failure/retry rate to quote — only manual-retry counts on OpenFace3.
5. **README vs code snapshot cadence** — the export README says screen capture is "1 frame per second"; the actual periodic cadence is **every 3 s** (`PERIODIC_SNAPSHOT_MS = 3_000`). Cite the constant, not the README.
