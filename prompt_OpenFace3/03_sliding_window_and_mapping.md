# Stage 3 — Sliding Window Aggregation + Editable Affective State Mapping

## Context

After Stages 1–2, the platform now stores per-frame `EmotionFrame` rows with the 8 universal emotions from OpenFace 3. This stage adds the **theory-grounded mapping** from raw emotion frames to four learner affective states: **Engagement**, **Boredom**, **Confusion**, **Frustration** — and makes both the **window period** and the **mapping rules** teacher-editable.

The mapping table teachers must be able to edit (these are the **defaults** based on D'Mello & Graesser-style learning-analytic literature and the table provided by the project lead):

| Affective State | Universal Emotions (ranked) | Logical Relationship | Default Rule |
|---|---|---|---|
| **Engagement** | Joy/Happiness, Neutral, Surprise | Weighted Probabilistic — high concentration is often Neutral; Joy and Surprise are transient markers of mastery | `0.45·pNeutral + 0.35·pHappiness + 0.20·pSurprise` |
| **Frustration** | Disgust, Anger, Sadness/Contempt | Disjunctive (OR) — typically manifests as either | `max(pDisgust, pAnger, max(pSadness, pContempt))` |
| **Confusion** | Anger, Disgust, Surprise/Fear | Conjunctive (AND) — combination during knowledge-gap detection | `min(pAnger, pDisgust, max(pSurprise, pFear))` (i.e., all three families must co-activate) |
| **Boredom** | Neutral, Sadness, Disgust | Weighted (Low Arousal) — neutral display with low-arousal weighting | `0.55·pNeutral + 0.30·pSadness + 0.15·pDisgust`, then multiplied by a low-arousal factor `(1 − max(pSurprise, pHappiness, pAnger, pFear))` |

These four formulas must be **editable by the teacher per course** through a UI. A teacher can change weights, change which emotions feed into each state, swap the operator (sum/max/min/product), and add a low-arousal modifier or threshold.

## Goal of Stage 3

1. Add Prisma models for sliding-window aggregations and per-course mapping configs
2. Build a **mapping engine** that evaluates the (editable) rules over a sliding window of `EmotionFrame` rows
3. Schedule the engine to compute aggregates (online for live sessions, batch for completed sessions)
4. Build the **teacher UI** to edit window period and mapping rules
5. Expose **read APIs** that Stage 4 will consume for visualization

## Deliverables

### 1. Prisma models

```prisma
// Per-course teacher-editable configuration of the mapping
model AffectiveMappingConfig {
  id                  String    @id @default(cuid())
  courseId            String    @unique
  course              Course    @relation(fields: [courseId], references: [id], onDelete: Cascade)

  // Sliding window settings
  windowSeconds       Int       @default(30)        // 5–300 valid range
  strideSeconds       Int       @default(10)        // 1–windowSeconds; how often a new window is computed
  minFramesPerWindow  Int       @default(5)         // skip windows with fewer detected-face frames

  // The editable rule set, stored as JSON. Schema validated by Zod on write.
  // See `MappingRuleSet` TypeScript type below.
  rules               Json

  // Versioning: when a teacher edits rules, we keep history
  version             Int       @default(1)

  updatedById         String?
  updatedAt           DateTime  @updatedAt
  createdAt           DateTime  @default(now())

  history             AffectiveMappingConfigHistory[]
  windows             AffectiveStateWindow[]
}

model AffectiveMappingConfigHistory {
  id                  String                  @id @default(cuid())
  configId            String
  config              AffectiveMappingConfig  @relation(fields: [configId], references: [id], onDelete: Cascade)
  version             Int
  windowSeconds       Int
  strideSeconds       Int
  minFramesPerWindow  Int
  rules               Json
  changedById         String?
  changedAt           DateTime                @default(now())

  @@unique([configId, version])
  @@index([configId])
}

// One row per (session, window). Computed by the mapping engine.
model AffectiveStateWindow {
  id                  String    @id @default(cuid())
  sessionId           String
  userId              String
  courseId            String
  configId            String
  config              AffectiveMappingConfig @relation(fields: [configId], references: [id])
  configVersion       Int

  windowStartWallMs   BigInt
  windowEndWallMs     BigInt
  framesInWindow      Int
  framesWithFace      Int

  // Final scores after the editable rules are applied (0.0–1.0)
  engagement          Float
  boredom             Float
  confusion           Float
  frustration         Float

  // The argmax label, useful for timelines / heatmaps
  dominantState       String    // 'engagement' | 'boredom' | 'confusion' | 'frustration' | 'none'

  // Mean of each universal emotion across the window (audit trail)
  meanHappiness       Float?
  meanSadness         Float?
  meanSurprise        Float?
  meanFear            Float?
  meanAnger           Float?
  meanDisgust         Float?
  meanContempt        Float?
  meanNeutral         Float?

  createdAt           DateTime  @default(now())

  @@unique([sessionId, windowStartWallMs, configVersion])
  @@index([sessionId, windowStartWallMs])
  @@index([userId, courseId, windowStartWallMs])
  @@index([courseId, windowStartWallMs])
}
```

Migration name: `add_affective_mapping_and_windows`.

### 2. Rule-set schema (TypeScript)

Define in `packages/shared/src/affective-mapping.ts` and export from the shared package so both API and frontend can validate:

```ts
// One term references one universal emotion probability.
// "p" fields come from EmotionFrame: pHappiness, pSadness, ..., pNeutral.
type EmotionField =
  | 'pHappiness' | 'pSadness' | 'pSurprise' | 'pFear'
  | 'pAnger' | 'pDisgust' | 'pContempt' | 'pNeutral';

// A "group" is an inner combination of emotions (used e.g. for Sadness/Contempt → max(pSadness, pContempt)).
type EmotionGroup = {
  op: 'max' | 'min' | 'mean' | 'sum';
  fields: EmotionField[];
};

type Term = EmotionField | EmotionGroup;

type WeightedTerm = { term: Term; weight: number };

// A rule defines how one affective state is computed from terms.
type AffectiveStateRule = {
  state: 'engagement' | 'boredom' | 'confusion' | 'frustration';
  // 'weighted_sum'  → Σ weight·term
  // 'disjunctive'   → max(term, term, ...)            (weights ignored; warns on save if any ≠ 1)
  // 'conjunctive'   → min(term, term, ...)            (weights ignored)
  // 'product'       → Π term^weight
  combinator: 'weighted_sum' | 'disjunctive' | 'conjunctive' | 'product';
  terms: WeightedTerm[];
  // Optional post-processing
  lowArousalModifier?: { fields: EmotionField[] }; // multiplies result by (1 − max(fields))
  threshold?: number;                              // any value below threshold becomes 0
  clamp01?: boolean;                               // default true
};

type MappingRuleSet = {
  schemaVersion: 1;
  rules: AffectiveStateRule[]; // exactly 4 — one per state
};
```

Provide the **default rule set** as an exported constant `DEFAULT_MAPPING` matching the table above. Seed every existing course with this default on migration.

### 3. Mapping engine

`apps/api/src/modules/affective-mapping/mapping-engine.service.ts`:

- **Input:** an array of `EmotionFrame` rows for one window + a `MappingRuleSet` + window metadata
- **Output:** an `AffectiveStateWindow` row (engagement/boredom/confusion/frustration scores in [0,1] + means)
- **Pure function** with no DB dependency — write unit tests covering:
  - All four default rules produce expected values for synthetic frames
  - `weighted_sum` with weights summing > 1 still clamps to [0,1] when `clamp01=true`
  - `disjunctive` ignores weights and returns the max
  - `conjunctive` returns the min
  - `lowArousalModifier` correctly attenuates Boredom when arousal-emotion probs are high
  - Window with < `minFramesPerWindow` returns `null` (caller should skip)

A separate `mapping-runner.service.ts` orchestrates:
- **Live runner:** subscribes to the `openface3:frames_ingested` Socket.IO event from Stage 2; for each session, maintains a rolling buffer and emits a new `AffectiveStateWindow` every `strideSeconds`. Persists to DB and broadcasts via Socket.IO event `affective:window_computed` to `teacher:session:${sessionId}`.
- **Batch runner:** a NestJS `@Cron` job runs every 2 minutes, finds completed sessions whose `EmotionFrame` data has not been fully windowed, and computes missing windows. Idempotent on `(sessionId, windowStartWallMs, configVersion)`.

When a teacher edits the mapping config, **bump `version`** and trigger a backfill job that recomputes all windows for that course's sessions under the new version. Old versions are retained (history) so teachers can compare.

### 4. API endpoints

All under `/api/affective-mapping`, JWT-protected, role-checked.

| Method | Path | Role | Purpose |
|---|---|---|---|
| `GET` | `/config/:courseId` | teacher/admin | Current config + default rule set reference |
| `PUT` | `/config/:courseId` | teacher (course owner)/admin | Update window/stride/minFrames/rules. Validates against the Zod schema. Bumps version, writes to history, triggers recompute. |
| `POST` | `/config/:courseId/reset-defaults` | teacher (course owner)/admin | Restore `DEFAULT_MAPPING` |
| `GET` | `/config/:courseId/history` | teacher/admin | List previous versions |
| `POST` | `/config/:courseId/preview` | teacher | Dry-run a candidate rule set against a chosen `sessionId`'s existing frames; returns the would-be windows without persisting. Used by the editor for live previews. |
| `GET` | `/windows?sessionId=&from=&to=&configVersion=` | teacher/admin | Paginated affective windows. Default `configVersion` = current. |
| `GET` | `/windows/student/:studentId?courseId=&from=&to=` | teacher/admin | Same, scoped |
| `GET` | `/windows/session/:sessionId/summary` | teacher/admin | Mean/median/peak of each affective state for the session, plus time-in-state (% of windows where state was dominant) |

### 5. Teacher UI: Mapping Editor

New route: `/teacher/courses/:courseId/affective-mapping`.

Add a link to it from the existing course-level biometrics config screen (the same one where Stage 2 added the OpenFace 3 toggle).

The page has three sections:

**A. Sliding window settings**
- Number input: window seconds (5–300, default 30, helper: "Length of each analysis window")
- Number input: stride seconds (1 to windowSeconds, default 10, helper: "How often a new window is computed; smaller stride = denser timeline")
- Number input: minimum frames per window (default 5, helper: "Windows with fewer detected-face frames are skipped")

**B. Mapping rules editor**

For each of the 4 affective states, render a card. Each card shows:
- The state name and a short description (pull from the table at top of this prompt)
- A combinator dropdown: `weighted_sum` / `disjunctive` / `conjunctive` / `product`
- A repeatable list of terms. Each term is either:
  - A single emotion (dropdown of 8 universal emotions)
  - A group of emotions (e.g. "max of Sadness and Contempt") — UI: an "add group" button that opens an inline picker
- A weight number input next to each term (disabled when combinator is `disjunctive` or `conjunctive`, with a tooltip explaining why)
- A "low-arousal modifier" toggle that, when enabled, lets the teacher pick which emotions count as arousal indicators (defaults to Surprise, Happiness, Anger, Fear for the Boredom rule)
- A threshold slider (0.00–0.50, default 0)
- A "clamp to [0,1]" toggle (default on)
- A small **live formula preview** that shows the rule rendered as math, e.g.:
  > `engagement = 0.45·pNeutral + 0.35·pHappiness + 0.20·pSurprise` (clamp 0–1)

**C. Preview panel**

- A session selector (dropdown of recent sessions in this course that have `EmotionFrame` data)
- A "Preview" button that calls `POST /api/affective-mapping/config/:courseId/preview` with the current unsaved rules and selected sessionId
- A small inline chart (4 lines, one per state, x = window start time) showing how the **draft** rules would score that session — without persisting
- A side-by-side toggle: "Compare with current saved version"

**Action buttons at the bottom:**
- "Reset to defaults" (with confirmation modal)
- "Save changes" — disabled until form is valid; on save, shows a toast: "Saved. Recomputing X sessions in the background."
- "Cancel"

**Important UX details:**
- Validate locally with the same Zod schema used on the API
- Show inline errors next to fields (e.g. "Weights must be ≥ 0", "Stride must be ≤ window")
- For `weighted_sum`: if weights don't sum to 1.0, show a non-blocking yellow warning ("Weights sum to 0.85 — final scores will be scaled accordingly. Continue?")
- For `disjunctive` / `conjunctive`: gray out and ignore weight inputs

### 6. Recompute on rule change

When `PUT /api/affective-mapping/config/:courseId` succeeds:
1. Bump `version`, write the previous values to `AffectiveMappingConfigHistory`
2. Enqueue a Redis job `affective:recompute` with `{ courseId, newVersion }`
3. A NestJS background processor consumes the job, finds all sessions in that course with `EmotionFrame` rows, and recomputes `AffectiveStateWindow` rows under the new version
4. Old-version windows are kept (do not delete) — they remain queryable by passing `configVersion=N`
5. Emit Socket.IO `affective:recompute_progress { courseId, percent, sessionsDone, totalSessions }` to the editing teacher's room so they see progress

### 7. Tests

- `mapping-engine.spec.ts` — unit tests as listed in §3
- `mapping-config.controller.spec.ts` — PUT validates the rule set, rejects invalid combinators, version bumps, history written
- `mapping-runner.spec.ts` — batch runner is idempotent; live runner emits at correct stride
- An end-to-end test: seed 60 s of synthetic `EmotionFrame` rows for one session, save default config, expect 5–6 `AffectiveStateWindow` rows (window=30 s, stride=10 s) with scores in expected ranges.

## Patterns to follow (read first)

1. The existing **derived-analytics computations** (Engagement Score, Cognitive Load Index, Emotion Timeline, Learning Velocity, At-Risk Flags) — find where these live in the API. Your mapping engine should sit alongside them.
2. The existing **course-config edit pattern** (versioning, history, audit trail). The platform already has versioning for KCs and content — find the closest pattern and mirror it.
3. The existing **Zod / DTO validation pattern** in `apps/api/src/modules/*/dto/`.
4. The existing **NestJS `@Cron`** usage — there's already a daily backup cron; copy its registration style.

## Acceptance criteria

- [ ] A new course gets `DEFAULT_MAPPING` seeded automatically
- [ ] Editing rules in the UI shows a live formula preview
- [ ] Saving rules writes a new version, history row, and triggers recompute
- [ ] Recompute progress is visible to the teacher via Socket.IO
- [ ] Old `configVersion` windows remain queryable
- [ ] Preview endpoint returns windows without persisting
- [ ] For default rules on a synthetic session where every frame is `pNeutral=1`, engagement ≈ 0.45 and boredom ≈ 0.55
- [ ] For a synthetic session where every frame is `pAnger=1`, frustration = 1.0, confusion = 0 (because `min(pAnger, pDisgust, max(pSurprise,pFear))` = 0 when only anger is present)
- [ ] Disjunctive/conjunctive combinators correctly disable weight inputs in the UI

## Out of scope for Stage 3

- Teacher-facing **dashboard** for viewing emotion logs and affective-state timelines across sessions and students (Stage 4)
- CSV export of windows (Stage 4)
- Per-student baselining / personalization of thresholds (future work — leave a `// TODO(future): per-student baseline` note where appropriate)
