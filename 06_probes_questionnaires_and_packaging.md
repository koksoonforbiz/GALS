# Stage 06 — Probes / Questionnaires + Desktop Packaging (optional)

**Run after stage 05.** This stage is optional and additive: surface
ground-truth probe/questionnaire data as a coding/analysis aid, and package GALS
Studio so a non-technical researcher can launch it with a double-click.

---

## Context

The methods review's single biggest gap is the absence of **in-session
ground-truth probes** to supervise the behavioral/biometric streams. If/when the
live GALS platform adds them, GALS Studio should ingest and align them. The
canonical probe schema from the review:

`probe_responses(id, sessionId, userId, ts, probeType, items JSON, latencyMs,
contextSnapshot JSON, scheduledTs, shownTs, completed)`

Probe types to expect: **ESM SAM** (valence/arousal/dominance + single-item
engagement + rotating boredom/confusion/frustration), **JOL/confidence** (post
item), **Paas mental-effort** (9-point), and pre/post/enrollment instruments
(**AEQ-S / PANAS / IMI / NASA-TLX / MSLQ**). Stage 01 already optionally exports
`probes/probes.jsonl`; stage 02 already has a `ProbeResponse` table. This stage
makes them useful.

---

## Task 1 — Probe ingest hardening

- Confirm the stage-01 exporter emits `probes/probes.jsonl` when probe data
  exists, and the stage-02 importer loads it into `ProbeResponse` with `items`
  preserved as JSON and timing fields (`scheduledWallMs`, `shownWallMs`,
  `latencyMs`).
- Add a `Questionnaire` table for session-level / trait-level instruments:
  `(id, sessionId?, userId, instrument, phase ∈ pre|post|enrollment, items JSON,
  scoredSubscales JSON, completedAt)`. Import from the bundle if present
  (extend the spec with a `questionnaires/questionnaires.jsonl` file, version
  bump optional/backward-compatible).
- Provide built-in **scoring** for the common instruments (AEQ-S subscales,
  PANAS PA/NA, IMI 4 subscales, Paas single value, NASA-TLX raw, MSLQ EF core).
  Keep scoring as pure functions in `packages/shared/src/analysis/instruments.ts`
  with unit tests against published scoring keys.

## Task 2 — Probe alignment in the coding studio

- In the coding studio (stage 04), render **probe markers** on the window strip
  and the player scrubber at their `shownWallMs`. Hovering shows the probe items
  and the student's response.
- For each coding window, surface any probe whose response falls within (or
  adjacent to) the window — this is the **probe ↔ coder-label alignment** the
  review wants for validation. Let the coder see the self-report without it
  biasing them (toggle: hidden by default during primary coding, available in a
  QA/review mode).

## Task 3 — Probe analysis (extend stage-05 dashboards)

- A **Ground Truth** tab: ESM trajectories (valence/arousal/engagement over the
  session), JOL calibration (predicted recall vs subsequent performance from
  `attempts`), Paas effort over epochs.
- **Convergent-validity** helpers the review names: AEQ-S boredom ↔ coded
  boredom prevalence; PANAS NA ↔ coded frustration frequency; IMI
  interest/enjoyment ↔ mean ESM engagement. Compute the correlations and show
  scatter plots with the expected r ≈ 0.30–0.50 reference band.
- Export probe + questionnaire data into the long-format research CSV and a
  dedicated `probes.csv` / `questionnaires.csv`.

## Task 4 — Desktop packaging

Make the whole thing launchable by a researcher without a terminal:

- Wrap the Fastify server + built web app in a single launcher. Two acceptable
  options — pick one and document it:
  1. **Tauri** (small binary, Rust shell) embedding the local server, or
  2. **Electron** wrapping the server + a `BrowserWindow` to `localhost`.
- On launch: ensure `STUDIO_DATA_DIR` exists, run Prisma migrations
  automatically, start the server on a free port, open the window/browser.
- A **first-run screen** that lets the user choose the data directory and import
  their first bundle(s). A visible "Data folder" path and a "Reveal in
  Finder/Explorer" button so they know where `studio.db` and media live.
- **Backup/restore:** a one-click "Export all coding" (zip of `studio.db`'s
  coding tables + `ReliabilityRun`s as CSV/JSON) so labels are safe independent
  of the media, and an "Import coding" to restore. (Coding durability is the
  top constraint.)
- Build scripts for **macOS, Windows, Linux** (study machines may be any of
  these). Document signing/notarization as out-of-scope but note where it'd go.

## Task 5 — Docs

- A short **researcher handbook** (`docs/RESEARCHER_GUIDE.md`): how to import a
  bundle, how to code a session (keyboard map), how the 2-rater + tiebreaker +
  gold-consensus workflow runs, how to read the reliability dashboard
  (κ vs PABAK vs α, the κ > 0.85 caution), and how to export for stats.
- An **operator guide** (`docs/OPERATOR_GUIDE.md`): exporting bundles on study
  laptops (stage 01 CLI), copying to the central machine, importing in bulk,
  backing up coding.

## Acceptance checks

- A bundle containing probes + questionnaires imports, scores subscales
  correctly (matches unit-test keys), and shows markers in the coding studio.
- The Ground Truth tab renders ESM trajectories and at least one
  convergent-validity scatter.
- The packaged app launches by double-click on the target OS, creates its data
  dir, runs migrations, and lets a first-time user import and open a session
  with no terminal.
- "Export all coding" → wipe `studio.db` → "Import coding" restores every
  annotation, coder, codebook version, and reliability run.
