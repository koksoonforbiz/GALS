# GALS Studio — Researcher Handbook

GALS Studio is an **offline** app for replaying instrumented learning sessions
and **coding** affect / behavior / executive-function events on a fixed
20-second window grid, then computing inter-rater reliability and analysis.

## 1. Import a bundle

1. Open the **Library** (the home page).
2. Either paste the absolute path to a `session_<id>/` folder (or `.zip`)
   produced by `gals-export`, or click **Upload .zip…**.
3. The validation report shows row counts, any checksum mismatches, and missing
   webcam segments. Valid data imports even if some warnings appear.

Re-importing the same session refreshes its streams/media only — **your coding
is never touched.**

## 2. Code a session (keyboard map)

Open **Code** on a session. Pick **who you are** and **which pass**
(`primary_rater_1`, `primary_rater_2`, or `tiebreaker`).

Each 20s window needs **one affect** and **one behavior**; EF events and
motivation indicators are optional and may repeat.

| keys | action |
|------|--------|
| `space` | play / pause the active window (with ±5s context) |
| `[` `]` or ← → | previous / next window |
| `1`–`9` | affect (1=engaged, 2=confusion, 3=frustration, 4=boredom, …, 9=unclear) |
| `q w e r t y u` | behavior (on-task … wtf) |
| `a s d f g h j k` | EF events (point) — toggle on/off |
| `z x c v` | motivation indicators (range) |
| `u` | unclear affect · `0` clear affect · `n` notes · `?` shortcuts |

Target **3–5 seconds per code**. Every code autosaves immediately (no save
button). With **auto-advance** on, completing affect+behavior jumps to the next
uncoded window. Coding resumes where you left off.

## 3. The 2-rater → tiebreaker → gold workflow

1. Two trained raters code the same session as `primary_rater_1` and
   `primary_rater_2` (independent sets).
2. The **disagreement queue** auto-lists windows where their affect or behavior
   differ. A **tiebreaker** opens the session, filters the strip to
   *disagreements*, sees both raters' choices, and picks the resolving code.
3. Click **Derive gold consensus**: windows where both primaries agree become
   gold; disagreements resolved by the tiebreaker take the tiebreaker's value;
   anything still unresolved is listed as *needs tiebreak*.

Lock the **codebook** version before gold coding so labels are comparable.
Editing a locked version forks a new one; annotations always reference the exact
version they were made under.

## 4. Reading the reliability dashboard

Analysis → **Reliability**. Always read three numbers together:

- **Cohen's κ** — chance-corrected agreement. ≥ 0.60 substantial (publish
  floor), ≥ 0.70 preferred.
- **PABAK** — prevalence-and-bias-adjusted κ. When a class is rare, κ deflates
  even at high agreement (the *kappa paradox*); PABAK corrects for it. A large
  PABAK−κ gap means your classes are skewed.
- **Krippendorff's α** — handles missing/ordinal data.

**κ > 0.85 triggers a caution banner** — near-perfect κ usually means collapsed
categories, not great coding. The confusion matrix and per-code agreement table
show which codes drag reliability down.

## 5. Analysis & export

- **Dynamics** — gold affect track, prevalence, dwell times, transition matrix,
  and the **cascade detector** (unresolved confusion→frustration→boredom; it
  ignores *resolved* productive confusion).
- **Attention** — per-AOI PDT, epochs, and the **allocation_score**.
- **Reading** — derived from `scrollHosts`/PDF pages (never window scrollY).
- **Ground Truth** — ESM trajectories + convergent-validity scatters.
- **Export** — windowed long-format, gold labels, session summary, reliability,
  probes, questionnaires as CSV for R/pandas. Headless equivalent:
  `studio-analyze --scope <id|all> --out ./out`.

## 6. Back up your coding

Library → **Export all coding (.zip)** saves coders, codebook versions,
annotations, and reliability runs independently of media. **Import coding**
restores them on any machine. Do this regularly — labels are the most valuable
artifact in the app.
