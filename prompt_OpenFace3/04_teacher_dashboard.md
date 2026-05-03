# Stage 4 — Teacher Biometric Dashboard: Emotion Logs + Affective State Visualization

## Context

Stages 1–3 built:
- OpenFace 3 worker producing per-frame `EmotionFrame` rows with 8 universal emotions
- Per-course config + backfill + observability
- Editable mapping engine producing `AffectiveStateWindow` rows for engagement / boredom / confusion / frustration
- Mapping editor UI at `/teacher/courses/:courseId/affective-mapping`

This final stage adds **teacher-facing visualization** so teachers can actually inspect emotion logs and the four affective states for each session. **No new data collection or model logic** — this stage is purely API read endpoints + frontend.

## Goal of Stage 4

1. Add an "Emotion & Affective State" view to the existing teacher biometric dashboard
2. Show per-session emotion logs (raw frames) with filtering and pagination
3. Show four affective-state timelines (engagement / boredom / confusion / frustration) with the same time axis as existing biometrics (gaze, pupil, AUs)
4. Show session-level summaries and at-a-glance student tiles
5. Allow CSV export of both emotion frames and affective windows

## Where this lives

The teacher portal already has these relevant routes from the platform summary:
- `/teacher/students/:studentId/logs` — Activity logs + biometric viewers
- `/dashboard/sessions/:sessionId/timeline` — SVG session timeline

**Extend these screens** rather than creating parallel ones. Find them in the codebase first and add the new visualizations as additional sections / tabs / overlays in the existing UI.

## Deliverables

### 1. Session timeline integration

In `/dashboard/sessions/:sessionId/timeline` (the SVG session timeline), add **two new lanes** below the existing biometric lanes:

**Lane: "Universal Emotions" (8 stacked traces)**
- One thin colored line per emotion (happiness, sadness, surprise, fear, anger, disgust, contempt, neutral)
- X-axis aligned to the existing wall-clock axis used by gaze/pupil/AU lanes
- Y-axis: probability 0–1, height ~120 px
- Toggle chips above the lane to show/hide each emotion (default: show all 8)
- Data source: `GET /api/openface3/frames?sessionId=&from=&to=&limit=` — paginate as the user pans/zooms the timeline
- Use a downsampling strategy: if the visible range contains >2000 frames, server-side bucket into `~1500` buckets and return mean prob per bucket. Add `?bucket=auto|none|<seconds>` to the API.

**Lane: "Affective States" (4 stacked traces)**
- Engagement (green), Boredom (gray), Confusion (orange), Frustration (red)
- Solid fills, ~140 px height
- Tooltip on hover shows all 4 scores + dominant state + window timestamp + frames-in-window
- Vertical markers when `dominantState` changes
- Data source: `GET /api/affective-mapping/windows?sessionId=&from=&to=&configVersion=`
- A small dropdown above the lane to switch `configVersion` (current vs. historical) so a teacher can see "what would the scores have looked like under last week's mapping rules" — this is the payoff for keeping config history in Stage 3.

Both lanes inherit the timeline's existing zoom/pan/playhead behavior. When the playhead is over a window, highlight that window's bar.

### 2. Live updates during an active session

The session timeline supports live mode (existing behavior — find how it currently subscribes to live AU data and copy that). Subscribe additionally to:

- `openface3:frames_ingested` (from Stage 2) → append new frames to the Universal Emotions lane
- `affective:window_computed` (from Stage 3) → append new bars to the Affective States lane

Show a small "Live" badge on each lane when receiving real-time data.

### 3. Per-student logs page

In `/teacher/students/:studentId/logs`, add a new tab "Emotion & Affect" (next to existing biometric tabs).

Tab contents:

**Top: Session selector**
- Dropdown of the student's sessions in the current course (default: most recent with emotion data)
- Date filter

**Middle: Stat cards (4 cards)**
- Mean engagement (with sparkline)
- Mean boredom (with sparkline)
- Mean confusion (with sparkline)
- Mean frustration (with sparkline)
- Each card also shows "% of session" (time spent with that state as the dominant one)

**Below: Two-tab content**

*Tab "Affective State Timeline"*
- The same affective-state lane from §1, full-width, taking the chosen session's full duration
- A "Compare with course average" toggle that overlays course-level mean lines (faded) for each state — pulls from `GET /api/affective-mapping/windows?courseId=&from=&to=` aggregated server-side

*Tab "Raw Emotion Log"*
- A virtualized data table of `EmotionFrame` rows with columns:
  | Time (wall) | Time (session) | Face? | Dominant | Happiness | Sadness | Surprise | Fear | Anger | Disgust | Contempt | Neutral | Head Yaw/Pitch/Roll |
- Column-level filters (e.g. "show only frames where dominant=disgust", "show only frames with face detected")
- Sort by any column
- Highlight rows whose `frameWallMs` falls inside a currently-selected affective window
- Pagination: 100 rows per page; total count shown at top
- Data source: `GET /api/openface3/frames` with all filters as query params

### 4. Course-level overview

In the teacher course view at `/teacher/courses/:courseId`, add a small "Affective State at a Glance" card on the dashboard:
- A horizontal stacked bar per enrolled student showing % time-in-each-state across all their sessions in this course
- Sort options: by engagement (high → low), by frustration (high → low), alphabetical
- Click a student bar → navigates to their `/teacher/students/:studentId/logs` "Emotion & Affect" tab with that course preselected
- Data source: a new endpoint `GET /api/affective-mapping/course/:courseId/overview` that returns `[{ studentId, studentName, totalWindows, pctEngagement, pctBoredom, pctConfusion, pctFrustration }, ...]`. Compute this with a single SQL aggregation query (do not loop in app code). Cache for 60 s in Redis.

### 5. CSV export

Two new endpoints, JWT + role-checked, returning `text/csv` with `Content-Disposition: attachment`:

- `GET /api/openface3/export/frames.csv?sessionId=...` — emotion frames (one row per frame, all 8 probabilities + face/headpose columns)
- `GET /api/affective-mapping/export/windows.csv?sessionId=...&configVersion=...` — affective windows (one row per window, 4 state scores + means)

Both stream the response (don't load into memory). Cap export rows at 200,000 with a clear error if exceeded; suggest narrower filters in the message.

Add "Export CSV" buttons to the relevant tabs/lanes:
- Session timeline: an export icon on each new lane
- Per-student "Emotion & Affect" tab: two buttons (frames / windows)

### 6. Empty / loading / error states

For every new view, include:
- **Empty:** "No emotion data for this session. Make sure OpenFace 3 is enabled in course biometrics, then trigger a backfill or wait for new sessions." with a link to `/teacher/courses/:courseId/...biometrics-config`
- **Loading:** skeleton placeholders matching the lane shape
- **Worker degraded banner:** if `GET /api/openface3/health` returns `workerReachable=false`, show the Stage 2 banner above the timeline
- **Mapping config drift:** if a session's windows are computed under a `configVersion` ≠ current, show a small info chip "These scores are computed under mapping version N (current is M). Recompute?" with a button that calls a recompute job for just that session

### 7. Accessibility & keyboard

- All charts have an "accessible data view" toggle (a `<table>` with the same data, screen-reader friendly, behind a button)
- Lane visibility toggles reachable by keyboard
- Color choices pass WCAG AA — do not rely on color alone; pair with patterns/labels (especially for the four affective states)

### 8. Tests

- Component tests for the two new timeline lanes (snapshot + interaction)
- Component test for the per-student "Emotion & Affect" tab
- API tests for the export endpoints (correct CSV headers, streaming, cap enforced)
- API test for the course overview endpoint with a seeded course of 3 students × 2 sessions each

## Patterns to follow (read first)

1. The existing **session timeline** at `/dashboard/sessions/:sessionId/timeline` — its SVG/canvas rendering, zoom/pan, live subscription. Add lanes inside that same component, not a sibling.
2. The existing **biometric tabs** in `/teacher/students/:studentId/logs` — tab structure, data fetching pattern, how it switches sessions.
3. The existing **Recharts usage** elsewhere in the teacher portal (the platform uses Recharts according to the stack — find the closest existing chart and reuse its themed wrapper).
4. The existing **CSV export** endpoint (the platform has `analysis/export_logs.py` and `POST /api/jobs/export-session`) — match those conventions for the new CSV endpoints. Decide: are these served by the NestJS API directly (preferred for these read-only filtered exports) or pushed through the Python analysis pipeline? Use NestJS direct streaming for these.

## Acceptance criteria

- [ ] Opening any session timeline now shows two new lanes (Universal Emotions, Affective States) when emotion data exists
- [ ] During an active session, both lanes update live as frames are ingested and windows are computed
- [ ] The per-student "Emotion & Affect" tab shows correct stat cards, sparklines, and a working raw-emotion table
- [ ] The course-level overview card lists every enrolled student and is clickable through to their tab
- [ ] CSV export downloads correctly for a 30-min session (~9k frames at 5 fps) without loading the response into memory
- [ ] Switching `configVersion` on the affective lane re-renders with the historical scores
- [ ] When OpenFace 3 worker is down, the degraded banner appears and existing data still renders
- [ ] All new charts have a screen-reader-accessible table fallback
- [ ] No new database collections or models needed — every view reads from `EmotionFrame`, `AffectiveStateWindow`, `AffectiveMappingConfig`, and `AffectiveMappingConfigHistory` (plus existing user/course/session tables)

## Out of scope for Stage 4

- New data collection (already done in Stages 1–2)
- New mapping logic (already done in Stage 3)
- Student-facing visualization of their own affective state (deliberate — the platform's design is teacher-facing for this signal; revisit in a future stage if needed)
- Real-time alerting/intervention triggers based on affective state (could be a future stage that ties into the existing intervention system: PRACTICE_TESTING / DISTRIBUTED_PRACTICE / STEPWISE_LEARNING / INTERROGATIVE_ELABORATION)

## Final note for the implementing agent

After Stage 4 ships, the loop is closed: emotions are detected (1) → piped through the system (2) → mapped to learning-relevant states with teacher-controlled rules (3) → surfaced to teachers in the dashboard (4). The architecture deliberately keeps the **mapping editable** so the platform can be tuned per cohort, per course, or per research study without code changes — this matters because the empirical AU/emotion → affective-state mapping is still an active research area in MMLA.
