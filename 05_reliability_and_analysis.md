# Stage 05 — Reliability + Analysis Dashboards + Export

**Run after stage 04.** Build the analysis layer at `/analysis`: inter-rater
reliability, affect dynamics, attention/SEEV allocation, reading exposure, and
research-grade exports. All metrics live in `packages/shared/src/analysis/` as
pure, unit-tested functions so the numbers are reproducible and reusable from a
CLI.

---

## Context

GALS Studio now imports sessions, replays them, and stores multi-coder
annotations on 20 s windows. This stage computes the statistics the methods
review requires and presents them for researchers. Key methodological rules from
that review — encode them, don't just compute a single coefficient:

- Report **Cohen's κ**, **PABAK**, **and Krippendorff's α together.** Raw κ
  deflates when a class is rare (the "kappa paradox"); PABAK corrects for
  prevalence; α handles ordinal/missing data. Treat **κ > 0.85 with skepticism**
  (likely collapsed categories) and flag it in the UI.
- Affect is a **time-series** problem: persist and display **per-state dwell
  times** and **transition matrices**, not just instantaneous proportions. The
  actionable signal is **persistent unresolved confusion → frustration →
  boredom**; instantaneous confusion is often *productive* and must not be
  treated as an alarm.
- Attention: per-AOI **PDT** (% dwell time), **epoch segmentation**, and the
  **allocation_score** = total-variation distance from expected attention
  weights. This is a first-class feature, not a footnote.
- Reading exposure: derive from `scrollHosts` + `pdfCurrentPage/Total`, **never**
  from window `scrollY`.

---

## Task 1 — Reliability metrics (`packages/shared/src/analysis/reliability.ts`)

Pure functions, fully unit-tested against textbook examples:

- `cohenKappa(rater1[], rater2[])` for nominal codes (affect, behavior),
  per dimension. Also expose the confusion matrix.
- `pabak(observedAgreement, k)` — prevalence-and-bias-adjusted κ.
- `krippendorffAlpha(reliabilityData, level)` with `nominal` and `ordinal`
  (for affect intensity) levels; handle missing values (uncoded windows).
- `percentAgreement`, plus per-code agreement so you can see which codes drag
  reliability down.
- Multi-coder generalization where it applies (Fleiss' κ if >2 raters ever).

Inputs are pulled from `Annotation` rows aligned by `windowId`: pair
`primary_rater_1` vs `primary_rater_2` for each dimension. Uncoded windows are
treated as missing (α) or excluded (κ), and the UI states which.

## Task 2 — Reliability dashboard

`/analysis` → **Reliability** tab:

- Scope selector: one session, a set of sessions, or all. Dimension selector
  (affect / behavior). 
- Headline cards: κ, PABAK, Krippendorff's α, % agreement, N windows, N
  disagreements. Color-code against thresholds: κ ≥ 0.60 substantial (publish
  floor), ≥ 0.70 preferred; **κ > 0.85 → caution banner**. Always show PABAK
  next to κ and explain the gap when prevalence is skewed.
- **Confusion matrix** heatmap (rater_1 × rater_2) per dimension; click a cell to
  jump into the coding studio filtered to those disagreement windows.
- Per-code agreement table (which codes are unreliable).
- "Compute & save" writes a `ReliabilityRun` row (with params) so results are
  versioned and reproducible.

## Task 3 — Affect dynamics (`analysis/dynamics.ts` + dashboard tab)

Using **gold_consensus** (fallback to a chosen rater) affect labels per window:

- **Prevalence** bar/donut of states across the session (expect engagement to
  dominate; boredom/confusion/frustration sparse — show counts, not just %).
- **Dwell-time** distribution per state (consecutive-window run lengths × 20 s).
- **Transition matrix** (state → next-state) with probabilities; render as a
  heatmap and an optional chord/Sankey.
- **Cascade detector:** highlight runs matching **confusion → frustration →
  boredom**, and distinguish **resolved confusion** (returns to
  engaged_concentration within a window or two = productive) from **unresolved**
  (escalates). Surface a per-session list of unresolved-confusion episodes with
  links to seek there in replay. Make the "resolution window" length a parameter
  (default: returns to engagement within 1–2 windows).
- A **timeline strip** of the gold affect track aligned under the session
  duration, so dynamics are visually scannable.

## Task 4 — Attention / SEEV (`analysis/attention.ts` + tab)

- **AOI PDT:** % of gaze dwell per region (`sidebar`/`lesson`/`pdf-viewer`/
  `chatbot`/`header`) using the same nested-region resolution as stage 03
  (smaller rect wins). Per-session and per-epoch.
- **Epoch segmentation** into `reading_lesson`, `intervention_active`,
  `chatbot_dialogue`, `navigating_modules`, `idle` from activity + AOI + visibility
  signals (document the rule set; keep thresholds as params).
- **allocation_score** = total-variation distance between observed PDT and an
  **expected weight vector** (configurable per epoch type / task; provide a
  sensible default and let the researcher edit expected weights in the UI).
  Show it per epoch and as a session rollup. This is the SEEV-derived attention
  feature the review calls uniquely valuable — make it prominent.
- Charts: PDT stacked bars over time, allocation_score line, gaze on-screen %
  decay across session quartiles (a sustained-attention proxy).

## Task 5 — Reading exposure (`analysis/reading.ts` + tab)

- Per content item: `pctRead`, `maxScrollDepth`, `pagesVisited[]`, `dwellSec`,
  derived from `scrollHosts` (lesson container `scrollTopPercent`) and
  `pdfCurrentPage/Total`. Compute both **furthest-reached** (skim-resistant) and
  **last-position** progress.
- Explicit banner: window `scrollY` is **not** used here and is unreliable in the
  docked layout. If a session only has window scroll (older bundle), mark reading
  exposure as "low-confidence / window-scroll only".

## Task 6 — Cross-signal alignment view (optional but high value)

A combined per-session "research timeline": gold affect track, epoch bands,
allocation_score, PDT, key EF-event point markers, chat/EF-detection markers,
and probe responses — all on one shared time axis, click-to-seek into replay.
This is where coders/PIs eyeball whether labels line up with behavior.

## Task 7 — Exports (`/analysis` → Export)

Everything must leave the app for R/Python:

- **Windowed long-format CSV:** one row per `(session, window, dimension,
  codingPass, coder)` with code, intensity, confidence, time range, plus joined
  per-window signal summaries (mean emotion probs, mean pupil, dominant AOI,
  epoch type, allocation_score for that window).
- **Gold labels CSV** (one row per window with the consensus affect/behavior).
- **Reliability CSV/JSON** (every `ReliabilityRun`).
- **Session-level summary CSV** (durations, prevalences, dwell stats, PDT,
  allocation rollup, reading exposure).
- A `studio-analyze` **CLI** that recomputes and exports all of the above for a
  scope without the UI (for batch/headless reproducibility).

## Engineering notes

- All analysis functions are **pure** and tested with known fixtures (hand-checked
  κ/PABAK/α values; a synthetic affect track for cascade detection). The
  dashboards only call these functions — no stats logic in React.
- Parameters (resolution window, expected attention weights, epoch thresholds)
  are explicit inputs saved into `ReliabilityRun.params` / export metadata so any
  number can be reproduced.

## Acceptance checks

- κ, PABAK, and α match hand-computed values on the unit-test fixtures.
- A rare-class fixture demonstrates the κ-vs-PABAK gap and triggers the
  prevalence note; a degenerate all-agree fixture triggers the κ > 0.85 caution.
- The cascade detector flags an unresolved confusion→frustration→boredom run in a
  synthetic track and ignores a resolved-confusion run.
- AOI PDT sums to ~100%; allocation_score is 0 when observed == expected and 1
  when fully disjoint.
- Reading exposure uses `scrollHosts`/PDF pages and flags window-scroll-only
  sessions.
- Long-format CSV opens cleanly in R/pandas and round-trips the coded labels.
