# Stage 3 — Teacher portal dashboard UI

```
UI ICON REMINDER (full rule and icon map are in stage 1)
- No emoji anywhere — UI, strings, comments, prompts, LLM output.
- All icons from `lucide-react`. 16px in dense controls, 20px in primary
  affordances. Stroke width 1.75.
- Reuse the affordance->icon map from stage 1; add a new Lucide icon only
  if no existing one fits.


CONTEXT
The detection engine from stage 2 is live and writing rows to EfDetection
on every student utterance. This stage adds the teacher-facing dashboard
that surfaces those rows.

The dashboard lives inside the existing teacher portal. Follow the layout,
typography, table component, and data-fetching conventions of the existing
`/teacher/students/:studentId/logs` and `/dashboard/sessions/:sessionId/timeline`
pages. Do NOT introduce a new design language.

NAVIGATION INTEGRATION

  - Add a new tab/section "Text-mining" to the existing session timeline
    page at `/dashboard/sessions/:sessionId/timeline`. The text-mining
    dashboard renders inside this tab.
  - Also add a route `/teacher/students/:studentId/text-mining` that
    aggregates across sessions for one student (linked from the existing
    student logs page).
  - Place a small "Text-mining" link in the existing teacher dashboard
    summary cards if your recon found that summary section.

CRITICAL UX RULE — DO NOT CONFLATE CHANNELS
The platform already shows a biometric-derived "Emotion Timeline"
(frustrated/confused/engaged/bored/neutral) computed from facial AUs.
The text-mining dashboard surfaces text-derived signals. These are two
independent measurement channels of partly overlapping constructs (notably
confusion, frustration, engagement, boredom). Treat them as separate views,
never average them, never silently merge them. Use the channel icons:

  Text-derived  -> MessageSquare   "from dialogue"
  Biometric     -> Camera          "from face / gaze / pupil"

In the per-construct row, show a small badge "from dialogue" so the teacher
knows which channel they are looking at. If feasible, render the biometric
emotion timeline alongside the text-mining timeline on the same time axis
so teachers can spot agreement/disagreement.

ENDPOINTS TO IMPLEMENT (replace the stage-1 stubs)

  GET /api/text-mining/sessions/:sessionId/dashboard

    Returns the live dashboard payload:

    {
      "rollingN": 5,                          // from EfTeacherSettings
      "totalUserMessages": 12,
      "constructs": {
        "metacognition_general": {
          "displayName": "Metacognition (general)",
          "labelType": "binary",
          "feasibility": 5,
          "warning": null,
          "disabled": false,
          "latest": {
            "messageId": "...",
            "label": "positive",
            "confidence": 0.86,
            "rationale": "...",
            "createdAt": "..."
          } | null,
          "rolling": { "positiveRate": 0.4, "n": 5 },
          "session":  { "positiveRate": 0.33, "n": 12 }
        },
        "working_memory": {
          "displayName": "Working memory load",
          "labelType": "ordinal",
          "feasibility": 2,
          "warning": "Text-only WM detection is weak; pair with keystroke features for production",
          "disabled": false,
          "latest": { ... },
          "rolling": { "distribution": { "low": 0.6, "medium": 0.2, "high": 0.2 }, "n": 5 },
          "session":  { "distribution": { "low": 0.5, "medium": 0.25, "high": 0.25 }, "n": 12 }
        },
        "engagement": {
          "displayName": "Engagement / off-task",
          "labelType": "engagement",
          "feasibility": 4,
          "warning": null,
          "disabled": false,
          "latest": { ... },
          "rolling": { "onTaskRate": 0.8, "n": 5 },
          "session":  { "onTaskRate": 0.75, "n": 12 }
        },
        ...
      }
    }

    Compute aggregations server-side. Use a single SQL query per construct
    (Postgres window functions are fine) — do not load all rows and reduce
    in Node. The session has up to ~hundreds of messages, but the dashboard
    will be hit by every teacher tab open.

    For ordinal `working_memory`, the rolling/session "distribution" is the
    fraction of detections with each label. For binary, "positiveRate" is
    `count(label='positive') / count(*)` excluding `label IN ('error','pending')`.
    For engagement, "onTaskRate" is `count(label='on-task') / count(*)`.

    Exclude `label IN ('error','pending')` from all aggregate denominators
    but report `errorCount` and `pendingCount` separately so the dashboard
    can show "(2 errors, 1 pending)" alongside the rate.

  GET /api/text-mining/sessions/:sessionId/detections

    Paginated raw-detection feed for the historical trace drawer.

    Query params:
      ?constructKey=metacognition_general    // optional filter
      &label=positive                         // optional filter
      &cursor=<opaque>                        // server-issued opaque cursor
      &limit=50                               // 1..200, default 50

    Response:
      {
        "items": [
          {
            "id": "...",
            "messageId": "...",
            "messageContent": "...",        // joined; trimmed to ~280 chars
            "constructKey": "...",
            "label": "...",
            "confidence": 0.0,
            "severity": null,
            "rationale": "...",
            "warning": null,
            "createdAt": "...",
            "model": "...",
            "promptVersion": 3
          },
          ...
        ],
        "nextCursor": "..." | null
      }

    Order by `createdAt DESC`. Include the joined message content so the
    drawer does not need a second fetch per row.

  GET /api/text-mining/students/:studentId/dashboard

    Same shape as the session dashboard, but aggregated across all sessions
    for that student. The "rolling" window applies to the most recent N
    messages across sessions ordered by createdAt. Add an optional
    `?courseId=` filter.

FRONTEND COMPONENTS

Create under `apps/web/src/features/text-mining/`:

  components/
    DashboardPanel.tsx          — the main dashboard panel (used in session timeline tab and student page)
    ConstructRow.tsx            — one row per construct
    LatestPill.tsx              — coloured pill for the "Latest" cell
    RollingBar.tsx              — sparkline / bar for rolling rate
    SessionStat.tsx             — session-level number or distribution bar
    TraceDrawer.tsx             — slide-out drawer with paginated detections
    ChannelBadge.tsx            — "from dialogue" badge with MessageSquare icon
    DisabledRow.tsx             — visual treatment for disabled (low-feasibility-skipped) constructs
  hooks/
    useDashboard.ts             — react-query hook; subscribes to Socket.IO `session:<id>` and invalidates on `ef.detection.batch.completed`
    useDetections.ts            — paginated react-query hook for the trace drawer
  pages/
    SessionTextMiningTab.tsx    — wraps DashboardPanel; mounts inside the existing session timeline route
    StudentTextMiningPage.tsx   — full page at `/teacher/students/:studentId/text-mining`

DASHBOARD LAYOUT (DashboardPanel)

  Header row:
    - Title: "Text-mining detections"
    - Sub-title: "From dialogue. Not biometric." (small, muted)
    - Right side: rolling-window N selector (number input 2..50, persists to EfTeacherSettings.rollingWindowN), refresh button (RefreshCw), export-CSV button (Download).
    - If `EfTeacherSettings.pauseIngestion` is true, render a yellow banner: "Detection paused. Resume in Settings." with a Pause icon.

  Construct table (one row per construct, 9 rows max):
    Columns:
      1. Construct name + Info icon (tooltip = warning text if any)
      2. Channel badge ("from dialogue" — MessageSquare icon)
      3. Latest: LatestPill component
         - binary positive    -> CircleCheck, semantic colour "good" if construct is metacog/monitoring/flexibility, "bad" if frustration/boredom/attention-failure
         - binary negative    -> CircleX or muted dash, depending on construct polarity
         - ordinal low        -> SignalLow (good for WM)
         - ordinal medium     -> SignalMedium
         - ordinal high       -> SignalHigh (concerning)
         - engagement on-task -> CircleCheck (good)
         - engagement off-task-> CircleX (concerning)
         - error              -> CircleAlert (red)
         - pending            -> Loader2 spinning
         Tooltip on hover: confidence + rationale.
      4. Rolling (N): RollingBar — for binary/engagement a horizontal bar from 0..100% with label. For ordinal a stacked 3-segment bar (low/med/high).
      5. Session %: SessionStat — same idea but full-session aggregates.
      6. Drill-in chevron (ChevronRight) opens TraceDrawer.

  Polarity mapping for "good colour" — apply CONSISTENTLY:
    metacognition_general: positive=good, negative=neutral
    metacognitive_monitoring: positive=good (catching errors is healthy), negative=neutral
    attention_regulation: positive=concerning, negative=good
    working_memory: low=good, medium=neutral, high=concerning
    cognitive_flexibility: positive=neutral (warning still visible), negative=neutral
    confusion: positive=concerning IF severity>=3, otherwise neutral; negative=good
    frustration: positive=concerning, negative=good
    engagement: on-task=good, off-task=concerning
    boredom: positive=concerning, negative=good

  Disabled constructs (when EfTeacherSettings.disableLowFeasibility=true):
    Render at 50% opacity with a small "Disabled" pill and a tooltip
    "Skipped to save API cost. Re-enable in Settings." Show no Latest /
    Rolling / Session figures.

  Low-feasibility constructs (feasibility <= 2) that are NOT disabled:
    Add a small TriangleAlert icon next to the name. Tooltip = warning.

TRACE DRAWER (TraceDrawer)

  Triggered by clicking a construct row's drill-in chevron.
  Slides in from the right at ~480px wide.
  Header: construct name + close (X icon).
  Filter bar: label filter (All / Positive / Negative / Error), date range,
              search.
  List: virtualised list of detections newest-first. Each row:
    - Timestamp (relative + absolute on hover)
    - Label pill (same colours as dashboard)
    - Confidence bar (0..1)
    - Rationale text
    - The student utterance (trimmed) — clickable, opens the dialogue
      message in a new tab via `ExternalLink` (the existing dialogue
      route can take a `?focusMessageId=` query param; if it does not yet,
      add it).
  Empty state: Inbox icon + "No detections match these filters."
  Infinite scroll using the cursor pagination from the API.

CSV EXPORT

  GET /api/text-mining/sessions/:sessionId/detections.csv
  Streams all detections for the session as CSV. Columns:
    timestamp, messageId, studentId, constructKey, label, severity,
    confidence, rationale, warning, model, promptVersion, messageContent.
  Reuse the platform's existing CSV streaming helper if the recon found
  one (the architecture summary mentions an analysis/export pipeline).

LIVE UPDATES

  - On mount, `useDashboard` calls the dashboard endpoint via react-query.
  - Subscribe to Socket.IO room `session:<sessionId>` on the
    `/text-mining` namespace.
  - On `ef.detection.batch.completed`, invalidate the dashboard query
    (lightweight refetch).
  - On `ef.detection.created` for a CURRENTLY OPEN trace drawer that
    matches the construct, prepend the new row to the list without
    refetching (optimistic merge).
  - If the WS disconnects, fall back to a 15-second polling refresh.

CROSS-CHANNEL COMPARE (optional but recommended)

  Below the construct table, add an opt-in collapsible section:
  "Compare with biometric channel".
  When expanded, render side-by-side mini-timelines for the four
  overlapping constructs (confusion, frustration, engagement, boredom)
  showing text-derived markers vs. the existing biometric Emotion Timeline
  on the same x-axis (time-in-session). Use the existing emotion-timeline
  component if your recon found it reusable; otherwise stub this section
  and revisit later. Do NOT compute an "agreement score" yet — surface
  both, let the teacher judge.

CONFIRMATION CHECKLIST FOR STAGE 3
  [ ] Session-timeline page has a "Text-mining" tab that renders the dashboard.
  [ ] Student page exists at `/teacher/students/:studentId/text-mining`.
  [ ] All 9 constructs render with correct label types and polarity colouring.
  [ ] Rolling-window N change persists to backend and updates aggregations on reload.
  [ ] Drill-in trace drawer opens, paginates, and links to the original dialogue message.
  [ ] CSV export downloads for a session and opens cleanly in Excel.
  [ ] Live updates arrive via Socket.IO during an active student session.
  [ ] Channel badge "from dialogue" appears on every row.
  [ ] No emoji anywhere; only lucide-react icons.

Do NOT proceed to stage 4 until the above is green.
```


---

## Navigation

- Previous: [stage_2_detection_engine.md](stage_2_detection_engine.md) — Default prompts, LLM client, dialogue hook, 9-construct orchestrator.
- Next: [stage_4_prompt_editor.md](stage_4_prompt_editor.md) — Settings extension, per-course prompt editor, version audit, try-it tester.
