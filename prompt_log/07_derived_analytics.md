# Prompt 07 — Derived Analytics: Scheduled Computation Jobs

## Stack Context

- **Backend**: NestJS with Prisma 6.19
- **No Next.js** — all API endpoints are NestJS controllers
- **Auth**: JWT guard (`@UseGuards(JwtAuthGuard)`) on all endpoints
- **Frontend**: Vite + React 18 SPA — no shadcn/ui, Tailwind CSS v4

---

## Task

Implement 5 derived analytics computations as NestJS services, expose them via
two API endpoints, and create a simple frontend dashboard card for the summary.

---

## Backend Structure

Create an `AnalyticsModule` at `src/analytics/` (NestJS module):

```
src/analytics/
  analytics.module.ts
  analytics.controller.ts
  analytics.service.ts
  computations/
    engagement.service.ts
    cognitive-load.service.ts
    emotion.service.ts
    learning-velocity.service.ts
    at-risk.service.ts
```

---

## Metric 1 — Engagement Score (per 60-second window)

**File**: `computations/engagement.service.ts`
**Target table**: `derived_engagement`

```
For each 60s window in the session:

clickRate         = count of click_logs in window / 60
scrollActivity    = count of scroll_logs where |scrollPercent change| > 5 in window
cursorMovement    = sum of Euclidean distances between consecutive cursor_logs in window
tabVisibleFraction = visible_ms / 60000  (forward-fill from visibility_logs)

Normalise each against session max (min-max):
  clickRate_norm, scrollActivity_norm, cursorMovement_norm

engagementScore = 0.30 * clickRate_norm
                + 0.20 * scrollActivity_norm
                + 0.30 * cursorMovement_norm
                + 0.20 * tabVisibleFraction
```

Upsert into `derived_engagement` with unique constraint on `(sessionId, windowStartMs)`.

---

## Metric 2 — Cognitive Load Index (per 60-second window)

**File**: `computations/cognitive-load.service.ts`
**Target table**: `derived_cognitive_load`

```
avgPupilDiameter  = mean(pupil_size_logs.pupilDiameter) in window
baseline          = mean(pupil_size_logs.pupilDiameter) in first 30s of session
pupilDilation     = avgPupilDiameter - baseline

gazePoints        = webgazer_logs (gazeX, gazeY) in window
gazeEntropy       = Shannon entropy of spatial distribution:
                    1. Divide viewport into a 5x5 grid of cells
                    2. Count gaze points per cell → proportions p_i
                    3. entropy = -sum(p_i * log2(p_i + 1e-10))
                    (simpler than KMeans, no ML dependency needed)

avgAU04           = mean(pyfeat_au_results.au04) in window
avgAU07           = mean(pyfeat_au_results.au07) in window

Normalise against session max, then:
cognitiveLoadIndex = 0.40 * pupilDilation_norm
                   + 0.30 * gazeEntropy_norm
                   + 0.30 * ((avgAU04 + avgAU07) / 2)_norm
```

Skip window if fewer than 5 data points in any modality; store null for that component.

---

## Metric 3 — Emotion Timeline (per 1-second window)

**File**: `computations/emotion.service.ts`
**Target table**: `derived_emotion_timeline`

AU → Emotion rules (evaluate in this priority order):

| Priority | Emotion      | Condition                                    |
| -------- | ------------ | -------------------------------------------- |
| 1        | `frustrated` | au04 > 2.0 AND au17 > 1.5 AND au23 > 1.0     |
| 2        | `confused`   | au04 > 1.5 AND au07 > 1.0                    |
| 3        | `engaged`    | au01 < 0.5 AND au04 < 1.0 AND au25 > 1.0     |
| 4        | `bored`      | ALL AUs < 0.5 for ≥ 5 consecutive 1s windows |
| 5        | `neutral`    | none of the above                            |

Per 1s window:

- Average all AU values from `pyfeat_au_results` in window
- Apply rules in priority order
- `confidence`: fraction of AU frames supporting the classification
- `auEvidence`: JSON of averaged AU values used

---

## Metric 4 — Learning Velocity (per KC, per session)

**File**: `computations/learning-velocity.service.ts`
**Target table**: `derived_learning_velocity`

```
For each unique kcId with mastery updates in this session:
  masteryStart  = earliest probabilityKnown for this session+KC
  masteryEnd    = latest probabilityKnown
  masteryDelta  = masteryEnd - masteryStart
  attemptsCount = count of kc_evidence rows for this session+KC
  durationMs    = timestamp of last evidence - timestamp of first evidence
  velocityScore = masteryDelta / max(1, durationMs / 60000)   // gain per minute
```

---

## Metric 5 — At-Risk Flags (per session, every 5 minutes)

**File**: `computations/at-risk.service.ts`
**Target table**: `derived_at_risk_flags`

Check last 5-minute window. Conditions:

| Key                     | Trigger                                                                      |
| ----------------------- | ---------------------------------------------------------------------------- |
| `low_engagement`        | `engagementScore < 0.3` in 2+ consecutive `derived_engagement` windows       |
| `cognitive_overload`    | `cognitiveLoadIndex > 0.8` in 2+ consecutive windows                         |
| `sustained_frustration` | emotion = `frustrated` in > 60% of `derived_emotion_timeline` rows in window |
| `inactive`              | No `activity_logs` rows in past 3 minutes                                    |
| `repeated_failure`      | `attempts.score < 0.4` on last 2 consecutive attempts                        |

```
riskLevel:
  0 conditions → do not write row
  1 condition  → 'low'
  2 conditions → 'medium'
  3+           → 'high'
```

Only write a new row if `riskLevel` changed from the most recent row for this session.

---

## API Endpoints

### `POST /analytics/compute`

Protected by `JwtAuthGuard`.

Body:

```typescript
class ComputeAnalyticsDto {
  sessionId: string;
  jobType: 'engagement' | 'cognitive_load' | 'emotion' | 'learning_velocity' | 'at_risk' | 'all';
}
```

Runs the requested computation. If `jobType === 'all'`, run all 5 in sequence.

Returns:

```json
{
  "success": true,
  "jobType": "all",
  "results": {
    "engagement": { "recordsWritten": 12, "durationMs": 340 },
    "cognitive_load": { "recordsWritten": 12, "durationMs": 520 },
    "emotion": { "recordsWritten": 720, "durationMs": 890 },
    "learning_velocity": { "recordsWritten": 5, "durationMs": 110 },
    "at_risk": { "recordsWritten": 2, "durationMs": 95 }
  }
}
```

### `GET /analytics/:sessionId/summary`

Protected by `JwtAuthGuard`.

Returns latest computed values for all 5 metrics:

```json
{
  "sessionId": "...",
  "engagement": {
    "windows": [...],
    "latestScore": 0.72,
    "averageScore": 0.65
  },
  "cognitiveLoad": {
    "windows": [...],
    "latestIndex": 0.45,
    "averageIndex": 0.51
  },
  "emotion": {
    "dominantEmotion": "engaged",
    "distribution": { "engaged": 0.6, "confused": 0.2, "neutral": 0.2 }
  },
  "learningVelocity": [...],
  "atRisk": {
    "currentLevel": "low",
    "activeConditions": ["low_engagement"],
    "history": [...]
  }
}
```

---

## Frontend Analytics Summary Card

Create `src/components/dashboard/AnalyticsSummaryCard.tsx`:

A simple card component (Tailwind only, no shadcn) shown on the teacher's session
detail view. Fetches from `GET /analytics/:sessionId/summary`.

Display:

- Engagement score as a horizontal progress bar (color: green/yellow/red by value)
- Cognitive load index as a progress bar
- Dominant emotion as a badge with emoji (😐 neutral, 😕 confused, 😤 frustrated, 🙂 engaged, 😴 bored)
- At-risk level as a colored badge (green=low, yellow=medium, red=high)
- A "Recompute" button that calls `POST /analytics/compute` with `jobType: 'all'`

Show a `Loader2` spinner from `lucide-react` while loading.
