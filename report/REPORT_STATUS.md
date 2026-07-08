# REPORT_STATUS.md

Fill-in checklist and build status for the LaTeX final report under `report/`.

## How to compile

```bash
cd report
pdflatex main && bibtex main && pdflatex main && pdflatex main
```

`biber` is **not** required — the bibliography uses `natbib` + `bibtex` (`plainnat`). No LaTeX engine was available in the authoring environment, so the report was verified by static lint rather than a live compile (see below); run the command above locally to produce the PDF.

## Verification performed (static lint)

| Check | Result |
|---|---|
| All `\input` section files present | PASS (16/16) |
| `\begin`/`\end` environment pairing | PASS (balanced per file and per environment name) |
| Brace balance across whole document | PASS (open = close, once escaped `\%`/`\&`/`\_` excluded) |
| Every `\cref`/`\Cref` target has a `\label` | PASS (incl. `lst:sm2`; `crefname` registered for listings) |
| Every `\cite*` key exists in `references.bib` | PASS |
| Every `references.bib` entry is cited | PASS |

Two `references.bib` entries carry an inline `VERIFY`/`\todo` note (the OpenFace 3.0 release citation and the MITERS reference); confirm both against the source record before submission.

## Placeholders to fill: 109 `\todo{}`

Each renders as an orange **[TODO: ...]** box in the PDF. The bulk (83) are in the results chapter, which is deliberately scaffolded (table skeletons + per-value placeholders) to be filled from the frozen study data. The rest are metadata (candidate/programme/supervisor) and a small number of empirical qualifiers in the discussion/limitations.

### Priority groups

1. **Report metadata** (`preamble.tex`, `00_titlepage.tex`) — candidate name, programme, institution, supervisor, date, declaration wording, acknowledgments.
2. **Research questions** (`02_introduction.tex`) — paste RQ1/RQ2 verbatim from the approved proposal.
3. **Study results** (`10_results.tex`) — all empirical values, tables, and figures once data are frozen.
4. **Result-dependent interpretation** (`11_discussion.tex`, `01_abstract.tex`, `14_conclusion.tex`) — one- or two-line summaries keyed to the frozen numbers.
5. **Data-quality specifics** (`08_sensing_and_logging.tex`, `12_limitations.tex`) — exact cutoff dates / affected session ranges from the deployment log.
6. **MITERS citation** (`03_background.tex`) — add from the proposal's reference list (no reference was fabricated).

## Full checklist by file

### `preamble.tex`

- [ ] **L72** _(front matter / preamble)_ — ...
- [ ] **L106** _(front matter / preamble)_ — Candidate name
- [ ] **L108** _(front matter / preamble)_ — Program name
- [ ] **L109** _(front matter / preamble)_ — Institution
- [ ] **L110** _(front matter / preamble)_ — Supervisor name
- [ ] **L111** _(front matter / preamble)_ — Submission month, year

### `sections/00_titlepage.tex`

- [ ] **L40** _Declaration_ — Insert the program's official declaration wording and signature block.
- [ ] **L44** _Acknowledgments_ — Acknowledgments text (supervisor, participants, institution).

### `sections/01_abstract.tex`

- [ ] **L39** _Abstract_ — N
- [ ] **L40** _Abstract_ — One-sentence summary of the validation result (agreement between
- [ ] **L41** _Abstract_ — One-sentence summary of

### `sections/02_introduction.tex`

- [ ] **L81** _Research questions_ — Replace RQ1 and RQ2 below with the verbatim wording from the approved

### `sections/03_background.tex`

- [ ] **L41** _Affect-aware intelligent tutoring systems_ — The proposal's literature review also cited MITERS; add the full

### `sections/04_scope_evolution.tex`

- [ ] **L122** _Proposed versus delivered: the eighteen items_ — Confirm final N.

### `sections/08_sensing_and_logging.tex`

- [ ] **L339** _Known data-quality caveats_ — State the cutoff date and list affected session
- [ ] **L345** _Known data-quality caveats_ — Identify affected sessions by date and

### `sections/09_measurement_methodology.tex`

- [ ] **L129** _Self-report instrument_ — Confirm the count of

### `sections/10_results.tex`

- [ ] **L8** _Results_ — 
- [ ] **L18** _Participants and data yield_ — N
- [ ] **L19** _Participants and data yield_ — demographic summary: age range, prior experience, recruitment
- [ ] **L20** _Participants and data yield_ — S
- [ ] **L20** _Participants and data yield_ — H
- [ ] **L21** _Participants and data yield_ — S_sr
- [ ] **L37** _Participants and data yield_ — S
- [ ] **L37** _Participants and data yield_ — mean duration
- [ ] **L38** _Participants and data yield_ — rows
- [ ] **L38** _Participants and data yield_ — \% frames with face
- [ ] **L39** _Participants and data yield_ — rows
- [ ] **L39** _Participants and data yield_ — \% frames with face
- [ ] **L40** _Participants and data yield_ — rows
- [ ] **L40** _Participants and data yield_ — mean confidence; \% above 0.5
- [ ] **L41** _Participants and data yield_ — rows
- [ ] **L41** _Participants and data yield_ — responses per session
- [ ] **L42** _Participants and data yield_ — rows
- [ ] **L42** _Participants and data yield_ — EF detections
- [ ] **L51** _Platform quality attainment_ — count
- [ ] **L52** _Platform quality attainment_ — count
- [ ] **L52** _Platform quality attainment_ — count
- [ ] **L54** _Platform quality attainment_ — If a rubric-based quality score was collected (e.g., a usability or
- [ ] **L62** _Cross-modal validation (RQ1)_ — window length
- [ ] **L63** _Cross-modal validation (RQ1)_ — value
- [ ] **L63** _Cross-modal validation (RQ1)_ — 95\% CI
- [ ] **L64** _Cross-modal validation (RQ1)_ — value
- [ ] **L64** _Cross-modal validation (RQ1)_ — windows
- [ ] **L64** _Cross-modal validation (RQ1)_ — participants
- [ ] **L65** _Cross-modal validation (RQ1)_ — value
- [ ] **L66** _Cross-modal validation (RQ1)_ — interpretation band
- [ ] **L91** _Cross-modal validation (RQ1)_ — 
- [ ] **L91** _Cross-modal validation (RQ1)_ — 
- [ ] **L91** _Cross-modal validation (RQ1)_ — 
- [ ] **L92** _Cross-modal validation (RQ1)_ — 
- [ ] **L92** _Cross-modal validation (RQ1)_ — 
- [ ] **L92** _Cross-modal validation (RQ1)_ — 
- [ ] **L93** _Cross-modal validation (RQ1)_ — 
- [ ] **L93** _Cross-modal validation (RQ1)_ — 
- [ ] **L93** _Cross-modal validation (RQ1)_ — 
- [ ] **L94** _Cross-modal validation (RQ1)_ — 
- [ ] **L94** _Cross-modal validation (RQ1)_ — 
- [ ] **L94** _Cross-modal validation (RQ1)_ — 
- [ ] **L99** _Cross-modal validation (RQ1)_ — State whether the facial engagement estimate or the AU-feature
- [ ] **L105** _Executive-function detection distributions_ — count
- [ ] **L129** _Executive-function detection distributions_ — one row per construct
- [ ] **L129** _Executive-function detection distributions_ — 
- [ ] **L129** _Executive-function detection distributions_ — 
- [ ] **L138** _Learning gain (RQ2)_ — first/best/last
- [ ] **L138** _Learning gain (RQ2)_ — n
- [ ] **L139** _Learning gain (RQ2)_ — value
- [ ] **L140** _Learning gain (RQ2)_ — value
- [ ] **L140** _Learning gain (RQ2)_ — $t$ or $W$
- [ ] **L140** _Learning gain (RQ2)_ — 
- [ ] **L141** _Learning gain (RQ2)_ — 
- [ ] **L141** _Learning gain (RQ2)_ — $d$ or rank-biserial
- [ ] **L141** _Learning gain (RQ2)_ — 
- [ ] **L142** _Learning gain (RQ2)_ — 
- [ ] **L165** _Learning gain (RQ2)_ — one row per KC
- [ ] **L165** _Learning gain (RQ2)_ — 
- [ ] **L165** _Learning gain (RQ2)_ — 
- [ ] **L165** _Learning gain (RQ2)_ — 
- [ ] **L188** _Intervention engagement_ — 
- [ ] **L188** _Intervention engagement_ — 
- [ ] **L188** _Intervention engagement_ — 
- [ ] **L189** _Intervention engagement_ — 
- [ ] **L189** _Intervention engagement_ — 
- [ ] **L189** _Intervention engagement_ — 
- [ ] **L190** _Intervention engagement_ — 
- [ ] **L190** _Intervention engagement_ — 
- [ ] **L190** _Intervention engagement_ — 
- [ ] **L191** _Intervention engagement_ — 
- [ ] **L191** _Intervention engagement_ — 
- [ ] **L191** _Intervention engagement_ — 
- [ ] **L202** _Group comparison for proposal items 16--17_ — name the DV
- [ ] **L203** _Group comparison for proposal items 16--17_ — did/did not
- [ ] **L204** _Group comparison for proposal items 16--17_ — $W$, $p$
- [ ] **L205** _Group comparison for proposal items 16--17_ — paired $t$-test / Wilcoxon signed-rank / one-way ANOVA /
- [ ] **L206** _Group comparison for proposal items 16--17_ — statistic
- [ ] **L206** _Group comparison for proposal items 16--17_ — 
- [ ] **L207** _Group comparison for proposal items 16--17_ — 
- [ ] **L207** _Group comparison for proposal items 16--17_ — 
- [ ] **L208** _Group comparison for proposal items 16--17_ — If a between-subjects factor other than
- [ ] **L215** _Secondary analyses_ — Report whichever of the analyses in \cref{tab:analyses} were run,

### `sections/11_discussion.tex`

- [ ] **L21** _Answering RQ1: can browser sensing detect learner states?_ — Interpret the observed $r$ and $\kappa$: if agreement is
- [ ] **L41** _Answering RQ1: can browser sensing detect learner states?_ — Report which
- [ ] **L58** _Answering RQ2: does the platform support learning?_ — Interpret the
- [ ] **L70** _Answering RQ2: does the platform support learning?_ — Report suggestion-uptake and completion-versus-dismissal
- [ ] **L116** _Threats to validity_ — N

### `sections/12_limitations.tex`

- [ ] **L53** _Data-quality limitations_ — Cutoff date and
- [ ] **L57** _Data-quality limitations_ — Affected sessions.

### `sections/14_conclusion.tex`

- [ ] **L38** _Conclusion_ — summarize in one or two sentences

### `sections/appendices.tex`

- [ ] **L143** _Default Intervention Prompt Templates_ — If the report is to reproduce the prompt templates verbatim, paste
