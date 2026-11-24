# Knowledge-test bank review (v2.0, 2026-11-24)

Review of `docs/assessment/knowledge_tests_v2.json`: 8 session tests (forms A/B, 8 items, 9 marks) and the pre/post-study test (forms A/B/C, 24 items, 29 marks). It answers two questions:

1. Does each question validly assess what the session (or course) teaches?
2. Can a pre→post gain be read as learning, rather than as an easier post-test form?

The bank is frozen research material and was **not changed**. Every fix below is a proposal for **v2.1**, or a way to handle the issue at analysis time.

Tags: **[C]** confirmed (checked against the item text) · **[J]** judgement call. Severity: **must** = threatens gain claims · **should** = weakens validity · **minor**.

## Verdict

The structure is sound, and the following were checked by script:

- every session form has 6 MCQ + a select-all item at slot 4 + an open item at slot 6;
- every study form has 18 MCQ + 4 select-all + 2 open items;
- keys are well formed, key positions are balanced, and no item uses "all/none of the above".

The bank is **not yet safe for gain claims**, for three reasons:

1. **Lesson rehearsal.** 13 form-A items (and 4 form-B items) closely copy check questions that the lesson itself shows with answers or feedback. A post-test on form A partly measures recall of rehearsed items.
2. **Unequal A/B pairs.** Many pairs share an objective label but test different sub-content, or differ clearly in difficulty. Session 4 is the worst.
3. **Study test overlaps session tests.** About two-thirds of study items closely paraphrase session items. Every student has seen both parent forms before the post-study test, so the study gain is confounded with exposure.

There is also a **test-wise pattern**. Keys often hedge ("measure", "replicate", "it depends") while distractors use absolutes ("always", "never", "guarantees"): about 40% of keys hedge against about 12% of distractors. In the study MCQs the key is the longest option in 41% of items. A test-wise student can score without the course.

## Problems by item

| Session | Form       | Slot                                                                                                       | Issue                                                                                                                         | Sev    | Proposed fix                                                               |
| ------- | ---------- | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ------ | -------------------------------------------------------------------------- |
| All     | A (mostly) | S1-7, S3-8, S4-2/3/6/8, S5-5/6, S6-1/3/5, S7-6, S8-2 (A); S4-3, S5-4, S6-5, S7-2 (B)                       | [C] Near-copies of lesson check items whose answers the lesson shows                                                          | must   | New-scenario isomorphs in v2.1; for now tag them as a "rehearsed" subscale |
| 1       | A↔B        | A7 / B6                                                                                                    | [C] A7's key (spell the word with spaces) is the substance of B6's rubric D1+D2                                               | should | Change one scenario                                                        |
| 2       | B          | 4                                                                                                          | [C] Off-objective (tightening a prompt, not rule ablation). Option D gives away B5                                            | must   | Replace with an ablation select-all item                                   |
| 2       | A/B        | 5–6                                                                                                        | [C] A tests positive/negative phrasing twice; B never does (B5 is about position)                                             | should | Re-pair by sub-objective                                                   |
| 2       | A          | 3                                                                                                          | [J] "Fix my code" with no code shown: answerable from general knowledge (same in study C4)                                    | should | Add a code excerpt, or drop                                                |
| 3       | B          | 3                                                                                                          | [C] The stem's "toward the label of the new last example" cues "recency"                                                      | should | Describe the outcome without "last"                                        |
| 3       | B          | 5                                                                                                          | [C] "Two points" on a 20-item set is impossible (steps are 5 points). Same flaw in S6-A8's key and study A18                  | should | "one item (5 points)"                                                      |
| 3       | B          | 6                                                                                                          | [C] The stem's results (70% vs 80% hold-out) give away D1/D2                                                                  | should | Remove the numbers                                                         |
| 3       | B          | 4, 7                                                                                                       | [J] B4 is general ML hygiene; B7's distractors C/D are implausible. B is easier overall                                       | should | Strengthen distractors                                                     |
| 4       | A, B       | 3                                                                                                          | [C] Distractors cite a rounding/discount rule that is not in the stem: easy to eliminate before the lesson, plausible after   | should | Rewrite distractors to fit the stem                                        |
| 4       | A          | 1                                                                                                          | [C] Three options say "fully established/proven"; the key is the only hedged one                                              | should | Mix hedged and absolute options                                            |
| 4       | B          | 4, 7                                                                                                       | [C] Off-objective (B4: Tree-of-Thoughts mechanics; B7: program-aided recall). B4 is harder than A4                            | should | Re-pair with A4/A7 objectives                                              |
| 5       | B          | 2                                                                                                          | [C] A JSON-mode item placed under the delimiter objective                                                                     | should | Move or replace                                                            |
| 5       | B          | 4                                                                                                          | [J] Key A ("add to the regression set") does not reduce risk for this document                                                | should | "…now or in future versions"                                               |
| 5       | A, B       | 6                                                                                                          | [C] Compound rubric dimensions (A-D1, B-D2): unclear whether both parts are required                                          | should | One criterion per dimension                                                |
| 6       | A          | 2 → 6                                                                                                      | [C] Within-form cue: A2's stem and key supply A6's example and decision rule                                                  | must   | Change A2's scenario                                                       |
| 6       | A          | 2                                                                                                          | [J] Distractor D ("one run, probably noise") is defensible under the course's own teaching on variance                        | should | "…across five matched runs"                                                |
| 6       | A/B        | 6, 8                                                                                                       | [J] A6 is recall and B6 is production; A8 is a quantitative interval and B8 a common-sense policy                             | should | Match cognitive level                                                      |
| 6       | B          | 2, 5                                                                                                       | [C] Off-objective (judge position bias; temperature)                                                                          | should | Re-pair                                                                    |
| 7       | A          | 6                                                                                                          | [C] Rubric D1 requires all five arguments plus one consolidated question; "date" is arguable if the app supplies today's date | should | "≥ 4 of 5; asks rather than invents"                                       |
| 7       | B          | 2, 5                                                                                                       | [C] Off-objective items                                                                                                       | should | Re-pair                                                                    |
| 8       | A          | 3, 8 → 6                                                                                                   | [C] Within-form cue: the keys of A3 and A8 name the "privilege layer" that A6-D2 asks for                                     | must   | Change A3/A8 wording                                                       |
| 8       | B          | 8 → 6                                                                                                      | [C] B8's key ("re-sample, iterate one element") is B6-D2                                                                      | should | Change B8                                                                  |
| 8       | B          | 7                                                                                                          | [J] The course's red-team rules can be answered from ethics alone                                                             | should | Tie to course-specific procedure                                           |
| 8       | A          | 3                                                                                                          | [J] Distractor D (strip links) is partly defensible                                                                           | minor  | Sharpen                                                                    |
| Study   | all        | many (e.g. A13=S7B1, A22=S6A8, A24=S7B6, B3=S2A1, B6=S3A3, B12=S6A2, C2=S1A3, C3=S2B1, C11=S6B4, C16=S8A7) | [C] About two-thirds of items closely paraphrase session items                                                                | must   | Build study forms from new scenarios for v2.1 or a delayed test            |
| Study   | A          | 23                                                                                                         | [J] The scenario has no tools, so the security dimension is harder; rubrics read as exhaustive lists                          | should | Add "or an equivalent course-consistent decision"                          |
| Study   | B, C       | 24 D1                                                                                                      | [C] Unclear how many alternative causes earn the mark                                                                         | should | "names ≥ 2"                                                                |

## Form equivalence by session

| Session     | Verdict                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------- |
| 1           | Roughly balanced. The open items differ in content (A: sampling; B: tokenisation)                                         |
| 2           | Not equivalent in coverage (phrasing vs position); difficulty about even                                                  |
| 3           | B easier on the items themselves (B3, B4, B6, B7); A gains a post-lesson advantage from A8                                |
| 4           | **A clearly easier after the lesson** (four lesson near-copies); B4 harder. Worst session                                 |
| 5           | A slightly easier (A5, A6 come from the lesson)                                                                           |
| 6           | A easier, mainly because A2 answers A6; A8 is the hardest single item                                                     |
| 7           | Balanced but noisy (A5, A6 hard; A6 is a lesson check item)                                                               |
| 8           | Roughly balanced once the cues are fixed; B7 is a free mark                                                               |
| Study A/B/C | Matched one-to-one by objective; differ at slot 22 (A hardest) and slot 24 (C hardest). Equal difficulty needs pilot data |

## Leakage between forms

Students never see keys, so leakage comes only from seeing the items and their options:

- **S1:** A7 ↔ B6 (spaced-letters check); A8's stem states B4-A's fact.
- **S4:** B3's scenario is A6's model answer.
- **S5:** A8 and A4-D carry B6's answer.
- **S7:** B5 carries A6-D2.
- **S8:** A4-D and B3's key.
- **Shared scenario:** S3 A8/B8 and S6 A3/S2 B8 reuse the same "replicate and inspect which items flipped" scenario.
- S3 A3/B3 swap mechanisms; this is acceptable.

The larger sources of leakage are lesson → form A and session items → study post-test.

## Controls already in place

- Session form order alternates per student and per session, so half the students take A first: `(rank + n) % 2`.
- Study form order is drawn from seeded permutations of A/B/C.
- Students never see keys or scores.
- Open answers are double-scored blind, with adjudication and Cohen's κ.
- Attempts are append-only, with `fastCompletion` and omitted-item flags.
- The importer refuses a bank that breaks the design rules.

**Gap:** form assignment is not yet stratified by experimental condition (TODO in `apps/api/src/knowledge-tests/assignment.ts`).

## Recommended actions

1. **Pilot and equate.** Run both forms with a naive (non-course) sample and a post-course sample; get item p-values, point-biserials and form means. In the study itself, the pre-tests (form randomised, taken before the lesson) give an unbiased estimate of form difficulty.
2. **Put form in the model.** Use a mixed model: score ~ time × condition + form + form × time, with student and item random effects. Pre-register the exclusion of the confirmed flawed items, and report "rehearsed" and "novel" subscales separately.
3. **Make condition × time the primary contrast**, since exposure is equal across conditions. Implement stratified counterbalancing before the study starts.
4. **Treat the study pre→post gain as exposure-confounded**, or build new-scenario study forms for v2.1 / a delayed test.
5. **v2.1 rewrites:**
   - remove the within-form cues for the open items (S6-A, S8-A/B, S2-B4D → B5);
   - fix the numeric impossibilities (S3-B5, S6-A8, study A18);
   - re-pair the off-objective B items;
   - balance hedged and absolute wording across keys and distractors to break the test-wise pattern.
