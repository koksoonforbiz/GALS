# Prompt 06 — Teacher Dashboard: Session Timeline Viewer

## Stack Context

- **Frontend**: Vite + React 18 SPA with React Router v6 (not Next.js)
- **Styling**: Tailwind CSS v4 + Lucide icons (`lucide-react`) — no shadcn/ui
  Build all UI components from scratch with Tailwind utility classes
- **Routing**: React Router v6 — add a new `<Route>` in the existing router config
- **Data fetching**: API calls to NestJS backend — reuse the existing fetch/axios
  pattern with JWT Bearer token
- All files go in `src/`

---

## Task

Create a session timeline page accessible at `/dashboard/sessions/:sessionId/timeline`
that shows a multi-track interactive visualisation of one student session.

---

## New NestJS Endpoint (Backend)

First, add this endpoint to the NestJS backend so the frontend can fetch all needed data:

`GET /sessions/:sessionId/timeline-data`

Protected by `JwtAuthGuard`. Returns:

```typescript
{
  recordingSegments: RecordingSegment[],
  interventions: LearningIntervention[],
  visibilityLogs: VisibilityLog[],
  keyActivityLogs: ActivityLog[],   // filter: action IN ['MODULE_OPENED', 'ASSESSMENT_SUBMITTED', 'DIALOGUE_STARTED', 'MATERIAL_UPLOADED', 'MODULE_COMPLETED', 'INTERVENTION_TRIGGERED']
  attempts: Attempt[],              // include score and submittedAt
  sessionSummary: SessionSummary,
  syncAnchor: SessionSyncAnchor,    // for wallClockMs (session t=0)
}
```

Add this to the existing sessions controller/service.

---

## Frontend Files

### Route Registration

In the existing React Router v6 config (find the router in `src/`), add:

```tsx
<Route path="/dashboard/sessions/:sessionId/timeline" element={<SessionTimelinePage />} />
```

### Page Component: `src/pages/dashboard/SessionTimelinePage.tsx`

- Reads `:sessionId` from `useParams()`
- Fetches from `GET /sessions/:sessionId/timeline-data` using the existing API client
- Shows a loading spinner while fetching (use Lucide `Loader2` with `animate-spin`)
- Shows an error message if fetch fails
- Renders `<SessionTimeline data={data} />` when loaded

### Timeline Component: `src/components/dashboard/SessionTimeline.tsx`

---

## Timeline Visualisation (SVG-based)

Render an SVG inside a `div` with `overflow-x: auto` for horizontal scrolling.

```
SVG layout:
- Left column (120px): track labels
- Right area: scrollable SVG canvas
- Total SVG width: sessionDurationSec * pixelsPerSecond * zoomLevel
- Track height: 40px per track, 8px gap between tracks
```

### Time Axis (X)

- Tick marks every 30 seconds
- Labels in `mm:ss` format
- Ruler line at top of canvas

### Tracks (rendered top to bottom)

| #   | Track Label     | Visual                                                                                                                           |
| --- | --------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Video           | Green filled rects for recorded segments; red rects for gaps                                                                     |
| 2   | Interventions   | Diamond markers colored by type: PRACTICE_TESTING=#3B82F6, DISTRIBUTED_PRACTICE=#8B5CF6, STEPWISE=#F97316, INTERROGATIVE=#14B8A6 |
| 3   | Tab Visibility  | Gray (#E5E7EB) band shading when tab hidden                                                                                      |
| 4   | Activity Events | Vertical tick marks with Lucide icon initials; different color per action type                                                   |
| 5   | Scores          | Filled circles; radius=8; color interpolated red→yellow→green by score 0→1                                                       |

### Zoom Controls

Render above the timeline:

```tsx
{
  [1, 2, 5, 10].map((z) => (
    <button
      key={z}
      onClick={() => setZoom(z)}
      className={`px-3 py-1 rounded text-sm ${zoom === z ? 'bg-blue-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}
    >
      {z}x
    </button>
  ));
}
```

### Interactions

Use `React.useState` for:

- `zoom: number` (default 1)
- `selectedEvent: EventData | null` (for tooltip/drawer)
- `jumpToInput: string` (mm:ss input value)

**Click on time axis**: find all events within ±5s of clicked time.
Show a floating tooltip (absolutely positioned div) listing them.

**Click on video segment rect**: show a side drawer/panel with segment metadata.

**Click on intervention diamond**: show panel with type, status, sessionData.

**Jump-to input**: parse `mm:ss` → seconds → pixels → `scrollContainerRef.current.scrollLeft = xPos`.

---

## Summary Panel

Render as a card grid above or beside the timeline:

```tsx
// Use Tailwind grid, no shadcn Card
<div className="grid grid-cols-2 md:grid-cols-3 gap-4 mb-6">
  <StatCard label="Session Duration" value={formatDuration(summary.durationSecs)} />
  <StatCard label="Recording Coverage" value={`${recordingCoverage.toFixed(1)}%`} />
  <StatCard label="Tab Visible" value={`${tabVisiblePct.toFixed(1)}%`} />
  <StatCard label="Interventions" value={interventions.length} />
  <StatCard label="Assessments" value={attempts.length} />
  <StatCard label="Avg Score" value={`${(avgScore * 100).toFixed(0)}%`} />
</div>
```

`StatCard` is a simple custom component — a white rounded div with label/value,
built entirely with Tailwind classes.

---

## Breadcrumb Navigation

At the top of the page:

```tsx
<nav className="flex items-center gap-2 text-sm text-gray-500 mb-4">
  <Link to="/dashboard">Dashboard</Link>
  <ChevronRight size={14} />
  <Link to="/dashboard/sessions">Sessions</Link>
  <ChevronRight size={14} />
  <span className="text-gray-800 font-medium">Timeline</span>
</nav>
```

---

## Session List Link

In the existing session list page/component, add a "View Timeline" button
to each session row:

```tsx
<Link
  to={`/dashboard/sessions/${session.id}/timeline`}
  className="flex items-center gap-1 text-sm text-blue-600 hover:text-blue-800"
>
  <BarChart2 size={14} />
  Timeline
</Link>
```

---

## Implementation Notes

- Convert all `BigInt` / string timestamps to `Number` before arithmetic and SVG positioning
- All time calculations relative to `syncAnchor.wallClockMs` as `t = 0`
- Use `useRef` on the scroll container for programmatic scroll (jump-to)
- Min SVG width: `Math.max(800, sessionDurationSec * 10 * zoom)` px
