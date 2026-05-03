# Claude Code prompts — EF/construct text-mining feature for the Adaptive Tutoring System

Four staged briefs to add an EF / learning-construct text-mining feature to the existing platform (NestJS 10 + Prisma 6.19 + PostgreSQL 16 + React 18 + TS + Vite + Tailwind v4 + Socket.IO).

This is an INTEGRATION, not a standalone app. The feature reuses:
- The existing dialogue ingestion flow (utterances come in via the dialogue gateway).
- The existing RAG retriever (for engagement-construct course context).
- The existing AI settings page (for provider selection and API keys).
- The existing teacher portal layout, table components, and data-fetching conventions.
- The existing Socket.IO infrastructure for live updates.

## How to use

Each `stage_*.md` file is a self-contained brief to paste into Claude Code in your repo root. Run them in order. **Each stage starts with a Reconnaissance step that tells Claude Code to read specific paths in your codebase first.** This step is mandatory — it's how Claude Code learns which existing functions to reuse instead of duplicating them.

Verify the "Confirmation checklist" at the bottom of each stage before moving on.

## Stages

| # | File | What it builds |
|---|---|---|
| 1 | [stage_1_reconnaissance.md](stage_1_reconnaissance.md) | Codebase audit, Prisma schema additions (3 new models), NestJS module skeleton with stubbed endpoints, Socket.IO gateway scaffold. |
| 2 | [stage_2_detection_engine.md](stage_2_detection_engine.md) | Default prompts seeded verbatim, LLM client reusing existing AI settings, dialogue ingestion hook, concurrent 9-construct detection orchestrator, reprocess endpoint. |
| 3 | [stage_3_dashboard.md](stage_3_dashboard.md) | Teacher-portal dashboard inside the existing session timeline tab, per-construct rows, rolling/session aggregations, historical trace drawer, CSV export, live updates. |
| 4 | [stage_4_prompt_editor.md](stage_4_prompt_editor.md) | Per-construct prompt editor under teacher portal, prompt versioning + audit, try-it tester, integration with existing AI settings page. |

## What each stage adds to the existing platform

**Stage 1 — Schema and module skeleton (no behaviour yet).**
- 3 new Prisma models: `EfDetection`, `EfConstructPrompt`, `EfTeacherSettings`.
- New NestJS module under `apps/api/src/text-mining/`.
- New Socket.IO gateway namespace `/text-mining` with `session:<id>` rooms.
- Stubbed endpoints (501) for everything implemented in later stages.
- A `text-mining-recon.md` document at the repo root capturing the integration points found in the existing codebase.

**Stage 2 — Detection engine.**
- Verbatim default prompts seeded into `EfConstructPrompt` (one global row per construct, `version=1`, `courseId=null`).
- LLM client that reuses the existing `AiSettingsService` for provider + key resolution.
- Hook injected into the existing dialogue message-creation function. Fire-and-forget — never blocks the chat round-trip.
- Concurrent 9-detector batch per utterance, semaphore-limited (default 6).
- Working memory uses ordinal low/medium/high (rewritten from the spreadsheet's binary form).
- Engagement gets course context from the existing RAG retriever — no parallel vector store.
- Errors on one construct do not block the other eight.
- Reprocess endpoint for retroactively scoring a session.

**Stage 3 — Teacher dashboard.**
- New tab "Text-mining" inside the existing `/dashboard/sessions/:sessionId/timeline` page.
- New cross-session rollup page at `/teacher/students/:studentId/text-mining`.
- 9 construct rows with: latest pill, rolling bar (N from settings), session aggregate, drill-in chevron.
- WM renders distribution; engagement renders on-task rate; binaries render positive rate.
- Polarity colouring tuned per construct (e.g. high WM = concerning, on-task = good, frustration positive = concerning).
- Trace drawer with cursor-paginated history, filter by label, link back to original dialogue message via `?focusMessageId=`.
- "From dialogue" channel badge on every row to distinguish from the existing biometric emotion timeline.
- Optional cross-channel compare section.
- CSV export.
- Live updates via Socket.IO with polling fallback.

**Stage 4 — Settings and prompt editor.**
- "Text-mining detection" section appended to the existing `/teacher/ai-settings` page (no parallel API-key UI).
- Detection-model override (so chat can run on `gpt-4o` and detection on the cheaper `gpt-4o-mini`).
- Rolling-window N, concurrency, disable-low-feasibility toggle, pause/resume switch.
- New page `/teacher/courses/:courseId/text-mining/prompts` (follows the existing intervention-prompts page pattern).
- Per-construct editor with feasibility badge, warning, version status, monospace textarea pre-filled with current prompt.
- Try-it tester (FlaskConical icon) — runs one detection without persisting.
- Save creates a new `EfConstructPrompt` version; old versions retained for audit.
- Trace drawer in stage 3's history can now resolve a `promptVersion` to the exact historical prompt text.

## The 9 constructs detected

| Key | Display name | Label type | Feasibility |
|---|---|---|---|
| metacognition_general | Metacognition (general) | binary | 5 |
| metacognitive_monitoring | Metacognitive monitoring | binary | 5 |
| attention_regulation | Attention / mind-wandering | binary | 2 |
| working_memory | Working memory load | ordinal (low/medium/high) | 2 |
| cognitive_flexibility | Cognitive flexibility | binary | 1 |
| confusion | Confusion (with optional 1-5 severity) | binary | 5 |
| frustration | Frustration | binary | 4 |
| engagement | Engagement / off-task | engagement (on-task/off-task) | 4 |
| boredom | Boredom | binary | 2 |

## House rules baked into every stage

- **Reconnaissance first.** Every stage starts by reading specific paths in the existing codebase and producing a short doc explaining how the new code will plug in.
- **Reuse, don't duplicate.** Existing AI settings, RAG retriever, dialogue ingestion, Socket.IO gateway, teacher portal patterns — all reused.
- **Never block the chat.** Detection is fire-and-forget. The student-facing dialogue must keep its current latency.
- **Two channels, separate views.** Text-derived constructs are tagged with the "from dialogue" `MessageSquare` icon. The existing biometric Emotion Timeline keeps its own channel. Never silently merge them.
- **No emoji, lucide-react only.** Stage 1 has the canonical affordance-to-icon map.
- **Audit-grade prompt versioning.** Every detection row references the exact `EfConstructPrompt.version` that produced it; old versions are kept indefinitely.

## Cost note

Default config calls 9 detection LLM calls per user message (chat is unchanged from existing). On `gpt-4o-mini` or `gemini-2.0-flash` that runs roughly $0.001-$0.002 per turn at typical utterance length. The "Disable low-feasibility detectors" toggle in stage 4 cuts this to 5 calls.
