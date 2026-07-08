# 00 — Capstone Evidence Pack: Index

> **Purpose:** A codebase-grounded evidence pack for the MSc capstone final submission, written from the **actual current code** on branch `claude/capstone-evidence-pack-h737h5` (based on `origin/KianYu`, 93 commits ahead of `milestone-1-monorepo`). Every claim in these files is cited to a `file:line`. Where a design doc, README, or CSV label contradicts the code, **the code wins** and the disagreement is flagged.
>
> This investigation was **read-only** — no source code was modified.

## The five documents

| File | Covers |
|---|---|
| [`01_functionality_inventory.md`](01_functionality_inventory.md) | Every API module + web surface, grouped instructor/student/sensing/analysis/workers, with maturity ratings; full Prisma model list |
| [`02_scope_and_deliverables.md`](02_scope_and_deliverables.md) | Status table vs the 18 proposal items (esp. 5, 6, 8, 10, 13), new-deliverables list, rewritten scope statement |
| [`03_learning_modes_and_interventions.md`](03_learning_modes_and_interventions.md) | Mode A (dialogue + chatbot + RAG pipeline), Mode B (lessons), the four interventions with verbatim SM-2 constants, strategy engine, auto-trigger check |
| [`04_sensing_and_logging.md`](04_sensing_and_logging.md) | Gaze, facial-model attribution, pupil, affective derivation, AOI/`allocation_score` formula, full logging inventory, replay + coding, CSV exporter, data-quality caveats |
| [`05_measurement_and_analysis.md`](05_measurement_and_analysis.md) | On/off-task validation, EF text-mining (9 constructs), learning gain, 10 ranked analyses, statistics-readiness for proposal items 15–18 |

---

## The 10 most important findings

1. **`emotion_frames` are produced by OpenFace 3.0, NOT Py-Feat.** The OpenFace3 worker does real inference (RetinaFace + MTL_backbone.pth) producing the 8-class AffectNet emotion probabilities (`openface3-worker/inference.py:104-135`). Py-Feat produces only the **18 AU intensities** in `pyfeat_au_results` (`pyfeat-worker/processor.py:122-145`). Both are real models, not stubs. *(doc 04 §2)*

2. **The source of the doc contradiction is a mislabeled CSV header.** `exportReplayCsv.ts:392` tags the emotion row with unit string `'string (py-feat)'` even though the data is OpenFace3. The data is correct; only the label is wrong. *(doc 04 §2.5)*

3. **Head pose is never computed — it is NULL in every `emotion_frames` row.** The columns exist but the worker hard-codes them NULL and discards the model's gaze tensor (`openface3-worker/main.py:176`, `inference.py:104`). *(doc 04 §2.3)*

4. **Pupil size is a crude webcam dark-pixel-area heuristic, not real pupillometry.** Fixed centre crop, threshold, `diameter = 2·√(darkPixels/π)` (`usePupilSize.ts:57-104`). Real pixels, low validity — disclose it. *(doc 04 §3)*

5. **Interventions are NEVER auto-triggered by affect/AU signals — CONFIRMED.** Only trigger reasons are `student_initiated` and `pre_generated`; the affect pipeline is teacher-facing analytics; the only cross-link runs the opposite way (`chat()` feeds text-mining). *(doc 03 §4)*

6. **SM-2 constants (verbatim):** ease floor 1.3, seed 2.5; interval 1→6→`round(interval·ease)`; failure (quality<3) resets `repetitions=0, interval=1`; ratings `again=1, hard=2, good=3, easy=5` (quality 4 never emitted; "hard" is a full lapse). `utils/sm2-algorithm.ts:14-42`. *(doc 03 §3.4)*

7. **`allocation_score` (exact) = duration-weighted mean of per-epoch alignments**, where per-epoch `alignment = 1 − 0.5·Σ|observed−expected|` (TV-distance) over 4 AOI buckets. `aoiScoring.ts:614-643`. Expected SEEV/EV weights are documented placeholders (`:111`). *(doc 04 §5.2)*

8. **Two independent, unwired affect derivations exist.** A server-side window pipeline (30 s/10 s, `AffectiveMappingConfig` rules → `affective_state_windows`) and a client-side per-frame threshold classifier (Replay slider + CSV) with **different engagement/boredom weights**. The Replay slider only re-labels the client one. *(doc 04 §4)*

9. **Self-report ground truth for validation EXISTS but is time-bounded.** Mandatory 5-option emotion survey every 15 min → `ActivityLog.metadata.emotion` (`EMOTION_SELF_REPORT`); its label space matches the machine states. But **~54 legacy sessions predate it (added 2026-07-01)** so they carry no self-report — a real n/power risk for proposal item 15. *(doc 05 §5)*

10. **The system evolved from an ITS into a multimodal learning-analytics platform.** Beyond the 18 proposal items it added session replay, AOI/SEEV scoring, four interventions, 9-construct EF text-mining, retrospective coding, multi-CSV export, dialogue mode, affective-mapping engine, and sync-anchor alignment. Items 5, 8, 10, 13 are best reported as **reframed**, not delivered-as-written. *(doc 02)*

---

## Discrepancy flags (doc-vs-code, partial features, wrong attributions)

### Model / data attribution
- **CSV mislabels emotion source as "py-feat"** — it is OpenFace3 (`exportReplayCsv.ts:392`). *(doc 04 §2.5)*
- **Head pose columns are always NULL** — no worker computes them (`openface3-worker/main.py:176`). *(doc 04 §2.3)*
- **Pupil "diameter" is a dark-area proxy in px**, not calibrated pupillometry (`usePupilSize.ts`). *(doc 04 §3)*
- **README says screen capture is "1 fps"; actual periodic cadence is every 3 s** (`PERIODIC_SNAPSHOT_MS = 3_000`). *(doc 04 §8.5)*
- **Server vs client affective pipelines use different engagement/boredom weights** (0.45/0.35/0.20 & 0.55/0.30/0.15 server; 0.4/0.4/0.2 & 0.5/0.3/0.2 client). *(doc 04 §4)*

### Vestigial / unwired schema
- **`ChunkingStrategy` enum (FIXED_SIZE/PARAGRAPH/SEMANTIC) is vestigial** — not consulted by ingest; real strategy is `markdown|code|paragraph|auto`; **no SEMANTIC implementation exists** (`rag.service.ts:535-541`). *(doc 03 §1.1)*
- **`Course.rerankTopK` (default 8) and `dblSettings.rerankTopK` are defined but unwired** — zero reads; actual top-k is hardcoded (10 / 5 / `topKChunks` 8). *(doc 03 §1.3)*
- **`StudioOutputType.TIMELINE` is a stub** — enum value with no prompt or content schema (`studio.service.ts:19-61`). *(doc 03 §2)*
- **`modality_offsets` table is never populated** by the reviewed paths. *(doc 04 §6)*
- **`UserMastery` BKT columns (`pLearn/pGuess/pSlip/pTransit`) are unused** — mastery uses EMA α=0.3, not BKT. *(doc 02 §1.4)*

### Behavioural contradictions
- **`resolveInterventionContext()` and `chat()` disagree on context precedence** — selection-first vs pdf-first — though both use the same `sel.length >= 20` rule; interventions throw on empty, chat records `'none'`. *(doc 03 §1.5)*

### Partial features / stubs
- **Teacher Dashboard is a stub** — stat cards hardcoded to `-`, no data fetch (`TeacherDashboard.tsx`). *(doc 01 §7)*
- **One true NotImplemented endpoint** — `POST /text-mining/sessions/:id/reprocess` (`text-mining.controller.ts:255`). *(doc 01 §4.1)*
- **AI grading of structured questions not closed** — `attempts.triggerAiGrading` writes placeholder `score=0` awaiting an external consumer not in-repo (`attempts.service.ts:437-500`). MCQ auto-grade and the separate `question-generation` open-ended grader *are* real. *(doc 01 §7)*
- **Two independent KC systems** (`ProposedKC` graph vs `KnowledgeComponent`/`UserMastery` mastery) are **not wired together** — blocks a mastery-driven learning path (proposal item 5). *(doc 02 §1.1)*
- **`FileParserService.parseImage` returns a hard-coded placeholder** (`file-parser.service.ts:185`). *(doc 01 §2.1)*
- **RAG has non-LLM template placeholders** when no API key (`rag/llm.service.ts:1265`); multimodal + contextual-retrieval flags default OFF. *(doc 03 §1.2)*
- **Stepwise Learning force-passes after 2 attempts** regardless of correctness (`:3101-3103`). *(doc 03 §3.3)*

### Data-quality caveats to disclose in the viva
- **Docked-layout window-scroll bug** — sessions before migration `20260601010000` (landed in squash `8638192`, 2026-06-03) have `scroll_hosts = NULL`; inner reading position unrecoverable. *(doc 04 §8.1)*
- **Replay truncation of emotion/AU frames** — cap was 5000 (≈17 min @5fps); raised to 50000 by `64b3510` (2026-05-21). Long sessions before that date silently truncated to the earliest 5000 frames. *(doc 04 §8.2)*
- **Hex-escape sanitization drops whole batches silently** — malformed `\x` payloads dropped with only a server warning; downstream CSV bins have gaps (`logs.service.ts:102-115`). *(doc 04 §8.3)*
- **PyfeatJob has no auto-retry / no `retries` column**; retry is manual only. `retries` exists only on `Openface3Job` and counts manual re-runs. Failed jobs = missing biometric rows, no auto-recovery. *(doc 04 §8.4)*

### Statistics gaps (proposal items 15–18)
- **No phase/condition/arm/group marker anywhere** — phase1/phase2 grouping must be defined externally. *(doc 05 §5)*
- **No stored effect-size or normalized-gain (`⟨g⟩`) field** — compute in analysis. *(doc 05 §3.4, §5)*
- **No enforced Attempt→Assessment relation**; pre/post pairing relies on hard-coded assessment titles; both are `mode:'practice'`. *(doc 05 §3)*
- **EF `label:'error'` rows are retained** and must be filtered before analysis. *(doc 05 §2.3)*

### Security flag (not a capstone claim, but worth knowing)
- **Command-injection surface** in `jobs.controller.ts:18` — un-validated `sessionId` interpolated into a shell command. *(doc 01 §5)*

---

## Method note

Findings were produced by reading the source directly — `schema.prisma` (2,542 lines), the two Python workers, and the API/web modules — and cross-checked against the design docs (`docs/BUG_REPORT_20260612.md`, `docs/PRE_STUDY_AUDIT_20260613.md`, `text-mining-recon.md`, `LLM_AUDIT.md`). Where those docs disagreed with code (notably the Py-Feat/OpenFace3 emotion attribution), the code was treated as authoritative and the disagreement recorded above. A second app tree, `gals-studio/` (studio-server), hosts the cohort multi-CSV exporters and additional research exporters and is referenced where relevant.
