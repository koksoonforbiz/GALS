# OpenFace 3 Emotion Detection — Staged Claude Code Prompts

Feed these four prompts to Claude Code **in order**. Each stage assumes the previous ones have shipped.

| File | Stage | What it adds | Touches |
|---|---|---|---|
| `01_openface3_worker_and_schema.md` | 1 | OpenFace 3 Python worker, `Openface3Job` + `EmotionFrame` Prisma models, ingestion API, Docker Compose service | `services/openface3-worker/`, `packages/db/prisma/schema.prisma`, `apps/api/src/modules/openface3/`, `docker-compose.yml` |
| `02_pipeline_integration.md` | 2 | Per-course enable/disable, backfill endpoint + UI, dead-letter queue, heartbeat-based degraded mode, live Socket.IO event | extends `CourseBiometricConfig`, the recording-segment-completed handler, the existing biometrics config screen |
| `03_sliding_window_and_mapping.md` | 3 | `AffectiveMappingConfig` + history + `AffectiveStateWindow` models, **editable mapping engine** (the 4-state mapping table from the project lead), live + batch runners, **mapping-editor UI** at `/teacher/courses/:courseId/affective-mapping`, recompute on rule change | new module + new teacher route + shared TS schema |
| `04_teacher_dashboard.md` | 4 | Two new lanes on the session timeline (Universal Emotions + Affective States), per-student "Emotion & Affect" tab, course-level overview card, CSV exports | extends existing `/dashboard/sessions/:sessionId/timeline`, `/teacher/students/:studentId/logs`, and `/teacher/courses/:courseId` |

## How to use

For each stage:
1. Open Claude Code in the repo root
2. Paste the entire contents of the stage file as the prompt
3. Let it read the existing patterns (the prompts explicitly tell it which files to read first)
4. Review the diff, run migrations, run tests, then ship before moving to the next stage

## Why staged

- **Stage 1** is purely additive — it can ship without any UI changes; useful as a smoke-test of the worker before committing to the full feature
- **Stage 2** makes the feature operationally safe (backfill, observability, degraded mode) — ship before turning it on for any real course
- **Stage 3** is the theory-grounded part the project lead specified — it's standalone because the **mapping is editable**, so it must be reviewed and tuned with whoever owns the pedagogical design before any teacher sees the output
- **Stage 4** is presentation-only — easy to revise without touching data or logic

## Theoretical alignment with the requirements

The four bullet points from the original request map to the stages as follows:

> 1. It has to be OpenFace 3 to output the universal emotions

→ Stage 1, §1 (worker uses OpenFace 3's emotion estimation head; the 8 outputs are stored as `pHappiness…pNeutral` on `EmotionFrame`)

> 2. Under the teacher portal / biometric dashboard should log data of each emotion detection during the session

→ Stage 4 §1 (Universal Emotions lane on the session timeline) + §3 ("Raw Emotion Log" tab in per-student logs) + §5 (CSV export of frames)

> 3. Allow the teacher to set the sliding window periods

→ Stage 3 §1 (`windowSeconds`, `strideSeconds`, `minFramesPerWindow` on `AffectiveMappingConfig`) + §5 ("Sliding window settings" section in the editor UI)

> 4. Output the four affective states (engagement / boredom / confusion / frustration) based on the mapping table, with editable mapping method

→ Stage 3 §2 (rule-set TS schema with `weighted_sum` / `disjunctive` / `conjunctive` / `product` combinators, group operators, low-arousal modifier) + §5 "Mapping rules editor" + §6 (recompute on edit) + §3 (`DEFAULT_MAPPING` matches the table provided)
