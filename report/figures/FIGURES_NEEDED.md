# Figures to prepare

Every figure referenced in the report, with its label, target section, source of truth,
and preparation notes. Figures marked **[TikZ — done]** are already drawn in LaTeX and
need no external file. Everything else needs a PNG/PDF dropped into `report/figures/`
with the exact filename given.

| # | File / label | Section | What it shows | How to produce it |
|---|---|---|---|---|
| 1 | *(TikZ in text)* `fig:architecture` | 5 System Architecture | Monorepo full-stack architecture: React/Vite web ↔ NestJS API ↔ PostgreSQL/Prisma, Redis, MinIO; the two Python CV workers; studio-server | **[TikZ — done]** in `05_system_architecture.tex`; replace with a polished diagram if preferred |
| 2 | *(TikZ in text)* `fig:sensing-pipeline` | 8 Sensing | Webcam segment → MinIO → Redis queues → OpenFace3 (8-class emotion) / Py-Feat (18 AUs) → `emotion_frames` / `pyfeat_au_results` → affective-mapping windows | **[TikZ — done]** in `08_sensing_and_logging.tex` |
| 3 | `rag_pipeline.png` — `fig:rag-pipeline` | 6 Learning Modes | Upload → chunk (512 tok / 100 overlap) → embed (per-provider models) → hybrid retrieval (dense + sparse + RRF k=60) → optional Cohere rerank → grounded prompt | Draw from doc 03 §1; a horizontal flow diagram. Placeholder box renders until the file exists |
| 4 | `replay_dataflow.png` — `fig:replay-dataflow` | 8 Sensing | 3-stage replay load (metadata+streams → paged snapshot metadata → on-demand content) and the sync-anchor time base unifying all streams | Draw from doc 04 §7.1; include `baseWallClockMs` anchor |
| 5 | `affect_dynamics.png` — `fig:affect-dynamics` | 2 Introduction / 3 Background | D'Mello & Graesser affect-dynamics model: equilibrium ↔ confusion → frustration → boredom cascade | Redraw the published model (cite D'Mello & Graesser 2012); do not scan the original |
| 6 | `replay_tab.png` — `fig:replay-tab` | 8 Sensing | Screenshot of the Replay tab: iframe playback, gaze/AOI overlays, multi-signal timeline, annotations panel | Screenshot from a demo session (anonymized student) |
| 7 | `aoi_regions.png` — `fig:aoi-regions` | 8 Sensing | The student course view with the four `data-replay-region` AOIs outlined (sidebar, lesson+pdf, chatbot, header) | Screenshot + colored rectangle overlay |
| 8 | `intervention_ui.png` — `fig:intervention-ui` | 7 Interventions | 2×2 montage of the four intervention views (Practice Testing, Elaboration, Stepwise, Flashcards) | Four screenshots stitched; anonymize |
| 9 | `chatbot_suggest.png` — `fig:chatbot-suggest` | 7 Interventions | The chatbot rendering a `[SUGGEST:…]` strategy card the student can click | Screenshot |
| 10 | `emotion_survey.png` — `fig:emotion-survey` | 9 Methodology | The 15-minute 5-option emotion self-report modal | Screenshot |
| 11 | `confusion_matrix.png` — `fig:validation-confusion` | 10 Results | Self-report × system-detected state confusion matrix (5×4) | Produce from analysis once study data is frozen |
| 12 | `gain_slopegraph.png` — `fig:gain-slopegraph` | 10 Results | Per-student pre→post slopegraph + normalized gain distribution | Produce from `attempts`/`grading_results` per doc 05 §3.3 |
| 13 | `allocation_decay.png` — `fig:allocation-decay` | 10 Results | Allocation score / AOI dwell by session minute | Optional; analysis #7 in doc 05 §4.2 |
| 14 | `ef_distribution.png` — `fig:ef-distribution` | 10 Results | EF detection counts/rates per construct (9 constructs), error rows excluded | From `ef_detections` |

Conventions: vector PDF preferred for diagrams, PNG (≥200 dpi) for screenshots; sans-serif
labels ≥ 9 pt at final size; color-blind-safe palette; no student names or emails visible.
