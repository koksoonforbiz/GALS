# RAG eval harness

Offline harness for measuring retrieval + generation quality across the
GALS RAG paths. Stage 01 of the upgrade plan
(`prompts_rag/01_audit_and_eval_harness.md`). The companion ground-truth
audit lives at `docs/rag/AUDIT.md`.

## What it measures

For each row in `gold/<corpus>_corpus.jsonl`:

1. **Retrieval** — runs the question through the production retrieval
   path (`RagService.queryChunks` for teacher, keyword scoring over
   `student_rag_chunks` for student, matching what `dialogue.service.ts`
   does today).
2. **Generation** — calls `LlmService.callLlmStructured` with the same
   grounded contract dialogue mode uses.
3. **Metrics** (judge LLM at `temperature: 0`):
   - `context_recall` — fraction of expected-answer claims that the
     retrieved context supports.
   - `context_precision` — fraction of retrieved chunks judged relevant.
   - `faithfulness` — fraction of generated-answer claims supported by
     retrieved context (claim-by-claim).
   - `answer_relevancy` — does the answer address the question.
   - `refusal_correctness` — for `is_refusal: true` rows, did the
     system correctly decline.
   - `citation_validity` — do emitted citations point at retrieved
     chunks.

A single judge failure scores that metric `null` for that row and never
crashes the run.

## Running

```bash
# From repo root.
pnpm --filter @ats/api rag:eval -- --corpus=all
pnpm --filter @ats/api rag:eval -- --corpus=teacher
pnpm --filter @ats/api rag:eval -- --corpus=student

# Regression check against a baseline.
pnpm --filter @ats/api rag:eval -- \
  --corpus=teacher \
  --compare apps/api/src/rag/eval/results/BASELINE-teacher.json \
  --tolerance=0.02

# Emit placeholder result files without touching the DB or LLM.
pnpm --filter @ats/api rag:eval -- --corpus=all --stub
```

### Required env vars for a real run

| Var | Meaning |
|---|---|
| `RAG_EVAL_JUDGE_USER_ID` | Teacher `User.id` whose LLM key the judge + generator use. Must have a `gpt-5.x`-or-better or `gemini-3.x` chat model saved via `/llm-settings`. |
| `RAG_EVAL_TEACHER_COURSE_ID` | `Course.id` to use for every teacher_corpus row whose `courseId` is the `__OPERATOR_FILL__` placeholder. |
| `RAG_EVAL_STUDENT_COURSE_ID` | Same, for student_corpus rows. |
| `RAG_EVAL_STUDENT_ID` | `User.id` of the seed student whose `student_source_documents` rows are queried. |

The runner also needs the same `.env` the API uses (`DATABASE_URL`,
`JWT_SECRET`, blob creds — bootstraps the full Nest `AppModule`).

## Output

`results/<git-sha>-<corpus>.json` — full per-row scores plus aggregates.
The runner also prints a summary table.

## Read-only contract

The harness MUST NOT write to:

- `document_chunks`, `source_documents`
- `student_rag_chunks`, `student_source_documents`, `student_source_guides`
- `chatbot_messages`, `dialogue_messages`, `dialogue_sessions`

It DOES write to `llm_usage_log` — the funnel writes a usage row on
every LLM call for cost tracking, and that's the expected non-
destructive side effect of running an eval.

## Adding gold rows

`gold/teacher_corpus.jsonl` and `gold/student_corpus.jsonl` are one JSON
object per line. Schema:

```jsonc
{
  "id": "tc-0NN",
  "corpus": "teacher" | "student",
  "question": "...",
  "expected_answer": "...",
  "must_cite": ["filename p.X", "figure 1"],   // hint only — used by graders
  "courseId": "__OPERATOR_FILL__",             // or a real UUID
  "studentId": "__OPERATOR_FILL__",            // student rows only
  "tags": ["figure", "stage05"],               // for filtering / Stage XX measurability
  "is_refusal": true                           // optional — refusal rows
}
```

Conventions:
- Tag at least **3 rows per corpus** with `is_refusal: true` so we can
  measure the unified refusal contract from Stage 06.
- Tag figure / table / chart questions with `tags: ["figure"]` etc. so
  Stage 05's multimodal ingest has a measurable target.
- Keep `expected_answer` short — it's a rubric for the judge, not a
  pasted document excerpt.

## Stage gate

Every later RAG stage's PR description must paste the before/after delta
against `results/BASELINE-*.json`. Do not merge a stage that regresses
`faithfulness` or `context_recall` on the gold set.
