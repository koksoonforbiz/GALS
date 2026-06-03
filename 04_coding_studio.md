# Stage 04 — Coding Studio (cued-recall coding: windows, codebook, multi-coder)

**Run after stage 03.** Build the coding workspace at `/coding/:sessionId` — the
centerpiece research feature. This is the retrospective cued-recall coding tool
the "Data Analysis" methods review specifies. It reuses the replay clock,
snapshot lookups, and webcam sync from stage 03.

---

## Context

Researchers (trained raters) watch synchronized DOM replay + webcam video and
assign affect / behavior / EF / motivation codes to fixed **20-second windows**,
two raters per session plus a tiebreaker, then reliability is computed (stage
05). The design requirements come straight from the methods review:

- Dual-pane synced player (DOM left, webcam right), shared scrubber, **±5 s
  context buffer** around the active window.
- **Fixed 20 s windows**, deterministic IDs (already created at import:
  `${sessionId}:${index}`).
- **Hierarchical, versioned codebook** with keyboard shortcuts; target **3–5 s
  per code**.
- Coding **passes**: `primary_rater_1`, `primary_rater_2`, `tiebreaker`,
  `gold_consensus`. Auto-built **disagreement queue** for the tiebreaker.
- An explicit **"unclear"** affect code to reduce forced false positives.
- Codebook follows BROMP + Pekrun seeds; version persisted per annotation.

---

## Task 1 — Seed the canonical codebook

In `packages/shared/src/codebook/`, define the default hierarchical codebook and
seed it as a `CodebookVersion` (`version: "1.0"`, `locked: false`):

- **AFFECT** (exactly one primary per window; ordinal `intensity?` optional):
  `engaged_concentration`, `confusion`, `frustration`, `boredom`, `delight`,
  `surprise`, `anxiety`, `neutral`, `unclear`.
- **BEHAVIOR** (exactly one per window): `on_task`, `on_task_conversation`,
  `off_task_idle`, `off_task_tab_switch`, `off_task_social`,
  `gaming_the_system`, `wtf_behavior`.
- **EF EVENT** (point annotations, may co-occur, multiple per window):
  `task_initiation_failure`, `distraction_onset`, `distraction_recovery`,
  `plan_articulation`, `goal_abandonment`, `help_seeking`, `self_correction`,
  `strategy_switch`.
- **MOTIVATION INDICATOR** (point or range): `high_effort_episode`,
  `effort_withdrawal`, `persistence_after_failure`, `giving_up`.

Each code carries: `key` (machine id), `label`, `dimension`, `color`, default
`shortcut`, short `definition`, and `inclusion`/`exclusion` notes (so the palette
can show tooltips). Shortcuts: affect on `1`–`9`, behavior on `q w e r t y u`,
EF events on `a s d f g h j k`, motivation on `z x c v`. Make them configurable
per coder later, but ship these defaults.

Build a small **Codebook editor** screen (under `/codebook`) to add/edit codes
and **lock** a version. Locking is required before "gold" coding so labels are
comparable. Editing a locked version forks a new version; annotations always
reference the exact version they were made under.

## Task 2 — Coding session setup

When a coder opens `/coding/:sessionId`:

- Pick **who I am** (select/create a `Coder`) and **which pass** I'm doing
  (`primary_rater_1` / `primary_rater_2` / `tiebreaker`). Default the pass based
  on existing coverage (e.g. if rater_1 done and I'm a new coder, suggest
  rater_2). Persist the choice in local app state so reload resumes.
- Show progress for this session: windows total, windows I've coded, windows
  remaining, and (for tiebreaker) disagreements pending.

## Task 3 — The coding layout

A focused, keyboard-first layout (deliberately denser than the analysis replay):

**Top — dual-pane synced player:**
- Left: DOM replay iframe (reuse stage-03 component). Right: webcam `<video>`
  (reuse stage-03 sync). **Shared scrubber** spanning the **active window ±5 s**
  context buffer, with the 20 s window region shaded and the ±5 s buffer faded.
- A compact emotion/AU/pupil mini-strip under the players for the active window
  (the face-channel cues the rater leans on), plus the chat/EF text that
  occurred in this window (text is a strong channel for confusion/frustration).

**Left rail — window strip:**
- Vertical (or horizontal) list of all windows, each showing its index, time
  range, and a colored chip per dimension once coded (affect color, behavior
  color, dots for EF/motivation). Current window highlighted. Click to jump.
- Filter: "uncoded only", "my windows", "disagreements" (tiebreaker).

**Right rail — codebook palette:**
- Grouped by dimension with the shortcut shown on each chip. Clicking or pressing
  the shortcut assigns the code to the **active window** (affect/behavior replace
  the single value; EF/motivation toggle/add). An **intensity** control (1–5) for
  affect when enabled, and a **confidence** control (low/med/high). A **notes**
  field. An explicit **"unclear"** chip.

**Bottom — transport + commit:**
- Prev/Next window (`[` / `]` or arrow keys), Play window, Replay window,
  speed control. **Auto-advance** toggle: after assigning the required
  affect+behavior for a window, optionally jump to the next uncoded window.
- A persistent "saved ✓" indicator; **autosave every annotation immediately**
  (no explicit save button) via `POST /api/annotations`. Optimistic UI with
  rollback on error.

## Task 4 — Annotation API + rules

- `POST /api/annotations` upsert: `(sessionId, windowId?, coderId, codingPass,
  dimension, code, intensity?, confidence?, atWallMs?/range?, notes?,
  codebookVersionId)`. For window-level single-value dimensions (affect,
  behavior) upsert on `(windowId, coderId, codingPass, dimension)`. For EF/motivation
  allow multiples per window; delete by annotation id.
- `GET /api/coding/:sessionId/state?coderId=&pass=` → per-window current
  annotations for this coder/pass + overall progress.
- Validation: affect and behavior are **required, single** per window per coder;
  EF/motivation optional/multiple. Don't block navigation on missing codes but
  surface "N windows missing affect" in progress.
- **Never** write to `CarriedAnnotation` (imported labels) — those are
  read-only reference; offer a "show imported labels" overlay for context only.

## Task 5 — Disagreement queue + gold consensus

- A derived view: for each window with both `primary_rater_1` and
  `primary_rater_2` present, compare per dimension. **Affect/behavior mismatch →
  flag as disagreement.** `GET /api/coding/:sessionId/disagreements`.
- **Tiebreaker mode** filters the window strip to disagreements only, shows both
  raters' choices side by side (and their notes), and lets the tiebreaker pick
  the resolving code (written as `codingPass: tiebreaker`).
- **Gold consensus derivation** (`POST /api/coding/:sessionId/derive-gold`):
  per window/dimension, if both primaries agree → that's gold; if they disagree
  and a tiebreaker exists → tiebreaker value is gold; else leave gold absent and
  list it as "needs tiebreak". Write results as `codingPass: gold_consensus`
  rows (idempotent: re-deriving overwrites prior gold for that scope only).

## Task 6 — Ergonomics

- Full keyboard flow: space = play/pause window, arrows/`[` `]` = window nav,
  number/letter keys = codes, `n` = notes focus, `u` = unclear, `0` = clear
  affect. A keyboard-shortcut help overlay (`?`).
- Show a per-window timer (how long the coder spent) and stash it in
  `Annotation.notes`/a `codingMs` field for QA of rushed coding.
- Resume exactly where the coder left off (last active window per coder/pass).

## Acceptance checks

- A coder can label affect+behavior for a window in **≤5 s** using only the
  keyboard, and the chip/strip updates immediately and persists across reload.
- Two coders coding the same session as `primary_rater_1` and
  `primary_rater_2` produce independent annotation sets; the disagreement queue
  correctly lists windows where their affect or behavior differ.
- Tiebreaker resolves a disagreement; `derive-gold` then yields a gold value for
  that window.
- Editing/locking a codebook version forks correctly and existing annotations
  still reference their original version.
- Re-importing the session's bundle (stage 02) leaves all of the above intact.
