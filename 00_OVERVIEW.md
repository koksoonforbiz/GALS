# GALS Replay & Coding Studio — Build Overview (read this first)

> This file is **context for Claude Code**, not a build step on its own. Read it
> before running any stage prompt. Stages `01`–`06` are meant to be executed
> **in order**, each in its own Claude Code session/turn. Every stage prompt
> repeats the context it needs, so you can run them independently, but the data
> model and folder layout are shared and additive.

## What we are building

An **independent, offline, single-machine** research application — call it
**GALS Studio** — for **replaying** instrumented student learning sessions and
**coding/labeling** affective state, executive-function (EF) events, and
behavior on top of that replay, plus **post-session analysis** (inter-rater
reliability, affect dynamics, attention allocation, reading exposure).

This is a **separate codebase** from the live GALS learning platform. It does
**not** connect to the live database. Instead, each study laptop running GALS
exports a **portable session bundle** (a folder/zip with no MinIO or Postgres
dependency); the researcher copies those bundles onto one centralized computer
and imports them into GALS Studio for analysis.

```
[Laptop A: GALS live] --export bundle--> [USB / network copy] --\
[Laptop B: GALS live] --export bundle-->                        --> [Central computer: GALS Studio]
[Laptop C: GALS live] --export bundle--> ----------------------/        - import bundles
                                                                         - replay
                                                                         - code / label
                                                                         - reliability + analysis
```

## Hard constraints (carry these into every stage)

1. **Offline / local-first.** No cloud calls, no auth server, no external DB.
   Everything runs on one machine via `localhost`. No telemetry.
2. **Portable bundles.** The analysis app ingests self-contained bundles. After
   import, the original GALS database is irrelevant — bundles are the contract.
3. **Researcher-friendly.** The primary users are research coders, not
   engineers. UI must be fast, keyboard-driven for coding, and forgiving.
4. **Durable labels.** Coding output must survive re-imports, app restarts, and
   bundle deletion. Coded annotations are the most valuable artifact in the app.
5. **Reproducible analysis.** Every reliability/analysis number must be
   re-derivable and exportable to CSV/JSON for downstream stats (R/Python).

## Tech stack (use this exactly unless a stage says otherwise)

- **Monorepo**, npm workspaces. Two packages: `apps/studio-web` (frontend),
  `apps/studio-server` (local backend). Plus `packages/shared` for types + the
  bundle spec + analysis algorithms (so they're unit-testable in isolation).
- **Frontend:** React 18 + Vite + TypeScript + Tailwind CSS + React Router v6.
  Charts: lightweight SVG (hand-rolled, like the existing ReplayTab) or
  `recharts` where a standard chart suffices. No heavyweight chart frameworks.
- **Backend:** Node + **Fastify** + TypeScript. Serves the API and streams local
  media files (HTML snapshots, JPEG screenshots, MP4 webcam). Single process.
- **Database:** **SQLite** via **Prisma** (the team already knows Prisma). One
  file `studio.db` in a configurable data directory. Media files stay on disk;
  the DB stores relative paths only.
- **Packaging (later):** runnable with one command (`npm run studio`), with an
  optional Electron/Tauri wrapper in stage 06.

This mirrors the live platform's stack (React/Vite/Tailwind + Prisma) so the
team can maintain both. Match the live repo's house conventions: additive
Prisma migrations only; triple-defensive try/catch around any media/iframe/canvas
code; hex-escape sanitization is not needed here (bundles are pre-sanitized) but
never let one bad row break an import batch.

## Repository layout (created in stage 02, referenced by all later stages)

```
gals-studio/
├── package.json                 ← npm workspaces root
├── apps/
│   ├── studio-server/           ← Fastify + Prisma (SQLite)
│   │   ├── prisma/schema.prisma
│   │   └── src/
│   │       ├── import/          ← bundle importer (stage 02)
│   │       ├── routes/          ← replay/coding/analysis/media APIs
│   │       └── media/           ← static file serving
│   └── studio-web/              ← React + Vite
│       └── src/
│           ├── pages/
│           │   ├── Library.tsx          ← imported sessions list (stage 02)
│           │   ├── Replay.tsx           ← replay viewer (stage 03)
│           │   ├── Coding.tsx           ← coding studio (stage 04)
│           │   └── Analysis.tsx         ← dashboards (stage 05)
│           ├── replay/          ← player, timeline, overlays, panels
│           ├── coding/          ← window strip, palette, queue
│           └── lib/             ← api client, time/clock helpers
├── packages/
│   └── shared/
│       └── src/
│           ├── bundle/          ← bundle format spec + zod validators
│           ├── analysis/        ← kappa/PABAK/alpha, epochs, PDT, allocation
│           └── codebook/        ← default hierarchical codebook
└── tools/
    └── gals-export/             ← the exporter that runs on study laptops (stage 01)
```

## The session bundle (the contract — defined fully in stage 01)

A bundle is a folder (optionally zipped) named `session_<sessionId>/` containing
`manifest.json`, `session.json`, per-stream JSONL files under `streams/`, DOM
HTML + screenshots under `snapshots/`, MP4 webcam under `webcam/`, message
streams under `messages/`, and optional `probes/` and `annotations/`. All
timestamps are **wall-clock milliseconds** (the same anchor the live ReplayTab
uses). Stage 01 specifies every field; stages 02+ consume it.

## What the research says the platform must do (source: "Data Analysis" review)

The coding/analysis design is driven by the methods review. Non-negotiable
research requirements distilled for the build:

- **Retrospective cued-recall coding** is the centerpiece: a **dual-pane synced
  player** (DOM replay + webcam) with a **shared scrubber** and **±5s context
  buffer**, segmenting each session into **fixed 20-second windows** with
  **deterministic window IDs**.
- A **hierarchical, versioned codebook** (AFFECT / BEHAVIOR / EF EVENT /
  MOTIVATION) with **keyboard shortcuts** (target 3–5 seconds per code).
- **Multi-coder workflow:** 2 primary raters + a tiebreaker, with **coding
  passes** (`primary_rater_1`, `primary_rater_2`, `tiebreaker`, `gold_consensus`),
  an **auto-built disagreement queue**, and a **gold-consensus** derivation.
- **Reliability dashboard:** Cohen's **κ**, **PABAK**, and **Krippendorff's α**
  (report all three; κ deflates on rare classes — the "kappa paradox").
- **Affect dynamics, not just proportions:** per-state **dwell times** and
  **transition matrices**; flag **persistent unresolved confusion →
  frustration → boredom** escalations; never treat instantaneous confusion as
  the alarm signal (productive confusion is good).
- **Attention/SEEV analysis:** per-AOI **PDT** (percentage dwell time), epoch
  segmentation, and the **allocation_score** (total-variation distance from
  expected attention weights).
- **Reading exposure:** prefer `scrollHosts` (inner container scroll) and
  `pdfCurrentPage`/`pdfTotalPages` for reading progress. **Do not trust window
  `scrollY`** — in the docked layout it is pinned near 0 and is meaningless.
- **Probes & questionnaires (optional ingest):** ESM/SAM, JOL, Paas effort, and
  pre/post instruments as ground-truth surfaces aligned to coding windows.

## How to run the stages

Feed Claude Code one stage file per session, in order:

1. `01_data_bundle_and_exporter.md` — define the bundle + build the exporter.
2. `02_scaffold_and_schema.md` — scaffold the app, schema, and importer.
3. `03_replay_core.md` — the replay viewer.
4. `04_coding_studio.md` — the coding studio.
5. `05_reliability_and_analysis.md` — reliability + analysis dashboards.
6. `06_probes_questionnaires_and_packaging.md` — probes ingest + desktop packaging (optional).

After each stage, run the stage's acceptance checks before moving on.
