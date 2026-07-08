# 03 — Learning Modes & the Pedagogy Layer

> **Basis:** Read from source on `claude/capstone-evidence-pack-h737h5`. Every constant is quoted from the code with a `file:line` citation. Where a schema comment or design doc contradicts the running code, the code wins and the contradiction is flagged.

The platform ships **two learning modes** (`Course.learningMode`, enum `LearningMode { STANDARD | DIALOGUE }`, `schema.prisma:114-117, 336`) plus **four evidence-based learning interventions** that overlay both modes. All grounded LLM calls flow through one shared prompt contract (`apps/api/src/rag/shared/grounded-prompt.ts`).

---

## 1. Mode A — Free-form open dialogue (NotebookLM-style) + floating/docked chatbot

There are actually **two distinct free-dialogue surfaces**, which are easy to confuse:

| Surface | Backend entry | Corpus it grounds on | Persistence |
|---|---|---|---|
| **Dialogue mode** (`/student/courses/:id/dialogue`) | `DialogueService.sendMessage` (`dialogue.service.ts:150-387`) | The **student's own uploaded** sources (`student_rag_chunks`, scoped to `studentId`) | `DialogueMessage` |
| **Floating / docked chatbot** (Learning Assistant) | `LearningInterventionsService.chat()` (`learning-interventions.service.ts:4027-4358`) | The **teacher's** module PDF/PAGE the student is viewing, or a selection, or student RAG | `ChatbotMessage` |

### 1.1 Upload → chunking (exact constants)

Both corpora chunk through one service — `SharedChunkingService` (`apps/api/src/rag/shared/chunking.service.ts`). The student-side `ChunkingService` is now a thin delegating shim.

Constants (`chunking.service.ts:75-81`):
```
DEFAULT_MAX_TOKENS     = 512
DEFAULT_OVERLAP_TOKENS = 100        // ~80–100 per Stage-02 spec
CHARS_PER_TOKEN        = 4          // rough approximation
MIN_CHUNK_SIZE         = 50
```
Derived (`:100-101`): **chunk size = 512 × 4 = 2048 chars; overlap = 100 × 4 = 400 chars.**

The **real** runtime strategy enum is `'markdown' | 'code' | 'paragraph' | 'auto'` (`chunking.service.ts:38`), resolved from MIME/filename (`resolveStrategy`, `:143-178`):
- **paragraph** (default): split on `/\n\s*\n/`, accumulate to 2048 chars; an oversize paragraph is re-split by sentence regex (`splitBySentences`, `:496-531`).
- **markdown**: split on heading boundaries `/(?=^#{1,3}\s)/m`; oversize → paragraph → sentence.
- **code**: regex function/class boundaries; oversize → `splitByLines`.

Overlap application (`applyOverlapAndFilter`, `:535-561`): chunks `< 50` chars dropped; for chunk *i*>0, the **last 400 chars of the previous chunk are prepended**. Page number estimated from `\f` form-feeds (`:565-571`).

> **⚠ Discrepancy (doc-vs-code):** The Prisma `ChunkingStrategy` enum (`FIXED_SIZE | PARAGRAPH | SEMANTIC`, `schema.prisma:85-89`) and the `SourceDocument.chunkingStrategy @default(PARAGRAPH)` column are **vestigial** — the in-code note at `rag.service.ts:535-541` states the column "is no longer consulted by ingest." **There is no `SEMANTIC` implementation anywhere.** Any report claiming semantic chunking would be wrong.

### 1.2 Embedding (exact models per provider)

Registry: `apps/api/src/llm/model-registry.ts:206-301`.

| Provider | Model ID | Dims | Notes |
|---|---|---|---|
| OpenAI | `text-embedding-3-small` | **1536** | default |
| OpenAI | `text-embedding-3-large` | **3072** | truncatable to 256/512/1024/1536 |
| OpenAI | `text-embedding-ada-002` | 1536 | deprecated |
| Gemini | `gemini-embedding-001` | **768** | truncatable 768/1536/3072 |
| Cohere | `embed-v4.0` | **1536** | `supportsImageEmbedding: true` |

Default map (`:292-301`): OpenAI→`text-embedding-3-small`, Gemini→`gemini-embedding-001`, Cohere→`embed-v4.0`. Batch sizes: OpenAI 100 (`:12`), Cohere text 96 / image 8 (`:20-21`). **Multimodal** (Cohere Embed-4, `chunkKind='page_image'`) hard-codes `dim = 1536` (`embedding.service.ts:326`); with no Cohere key, image inputs are silently dropped (`:386-405`). **Contextual-retrieval** (Stage 03) prepends a 50–100-token blurb (`contextualText`) to the chunk before embedding (`rag.service.ts:352`), soft-cap 150 tokens, `temperature:0` — **default OFF** (`RAG_CONTEXTUAL_RETRIEVAL`).

Fallback: a SHA-256 pseudo-embedding (sentinel `sha256-pseudo`) matches only identical tokens; **blocked in production** (`embedding.service.ts:58-71`).

### 1.3 Hybrid retrieval (dense + sparse + RRF)

Retriever: `apps/api/src/student-rag/student-rag-retrieval.service.ts`.

- **RRF constant:** `RRF_K = 60` (`:198`). Formula (`reciprocalRankFusion`, `:995-1041`): `rrfScore = weightOf(chunk) × (1 / (RRF_K + rank + 1))`; dense + sparse contributions summed per chunk, sorted desc, sliced to `topK × 2`.
- **Dense:** in-memory cosine over JSONB vectors, grouped by pinned `(embeddingModel, embeddingDimensions)`, query re-embedded once per tuple, dimension-mismatched groups hard-skipped (`:355-541`).
- **Sparse:** ILIKE over `content` + `contextualText` + `caption` with a BM25-like score `matchCount / (matchCount + 1.5·(1 − 0.75 + 0.75·haystack.len/2000))` (`:962`); STOPWORDS filtered.
- **top-k:** `candidateK = rerankEnabled() ? max(rerankCandidateK(), topK) : topK`; dense fetch `candidateK×2`, RRF returns `topK×2`, dedup (Jaccard > 0.9 dropped), reranker output finally `slice(0, topK)`.
- **Cohere rerank:** `RAG_RERANK` **default false** (`reranker.flags.ts:39`), candidate-K default 30, timeout 2000 ms, model `rerank-english-v3.5`. Triple-defensive no-op fallback preserves RRF order (`reranked:false`) whenever there is no Cohere key or any failure/timeout.

> **⚠ Discrepancy (doc-vs-code):** The schema comments say the teacher path uses `Course.rerankTopK` (default 8) and the student path uses `dblSettings.rerankTopK`. **A full-tree grep finds zero reads of either field.** Actual top-k is a hardcoded literal at each call site: teacher retrieval `topK = 10` (`rag.service.ts:738, 756`), interventions `topK = 5` (`learning-interventions.service.ts:1247, 1408`), dialogue `dblSettings.topKChunks` default 8 (`dialogue.service.ts:191`). The `rerankTopK` fields are **defined but unwired**.

### 1.4 Prompt assembly + persistence

Single contract: `buildGroundedMessages` (`grounded-prompt.ts:150-257`). System prompt = persona + a fixed `GROUNDING_CONTRACT` (`:119-125`) demanding *"Answer ONLY from the supplied sources… CITE every claim with `[Source N: filename.pdf, p.X]`… If the sources do not contain the answer, say so explicitly and do not guess."* Context is a `--- SOURCES ---` block, one labelled entry per text chunk plus image-attachment stubs; history is emitted as real user/assistant turns.

Persistence:
- **`DialogueMessage`** — written in a `$transaction` for both USER and ASSISTANT turns; ASSISTANT carries parsed `citations` + rich `tokenUsage` (incl. `faithfulnessFired/Passed/Regenerated`) (`dialogue.service.ts:295-335`).
- **`ChatbotMessage`** — `createMany` of USER+ASSISTANT, **fire-and-forget** (`learning-interventions.service.ts:4315-4355`); persists `contextSource`, `selectedText` (≤4000 chars), `currentPage`, `suggestedStrategy`, token counts, `model`.

### 1.5 `resolveInterventionContext()` — the context fallback chain

`learning-interventions.service.ts:760-1075`. Returns `{ text, source, evidence }` with `source ∈ {'selection','pdf-source','student-rag'}`. **Precedence (first hit wins):**

1. **selection** (`:789-800`): `sel = stripSlideBoilerplate((dto.selectedText ?? '').trim())`; **if `sel.length >= 20` → `source:'selection'`.** This is the **≥20-char selection rule**. (`stripSlideBoilerplate` removes `SMU Classification: Restricted` before the length test, `:34-43`.)
2. **pdf-source** (`:808-996`): only if `dto.contentId` set. Subtopic mode → teacher hybrid retriever; page mode → clamp and slice DocumentChunks by `pageNumber BETWEEN`; else full PDF text. Returns a synthesised single grounded chunk `Source 1: <filename>`.
3. **student-rag** (`:1018-1066`): builds a RAG query (topic → derived-from-content → course title), retrieves raw chunks (topK 5), returns `source:'student-rag'`.
4. **fail** (`:1069-1074`): throws `BadRequestException('No indexed materials yet…')`. **There is no `'none'` for interventions.**

> **⚠ Discrepancy (code-vs-code):** `ChatbotMessage.contextSource` is NOT set by `resolveInterventionContext()` — it is set by `chat()` (`:4027-4356`), whose precedence **differs**:
>
> | | selection test | order | on empty |
> |---|---|---|---|
> | `resolveInterventionContext()` | `sel.length >= 20` | **selection → pdf-source → student-rag** | throws BadRequest |
> | `chat()` | `sel.length >= 20` (`:4178`) | **pdf-source(contentId) → selection → student-rag** | records `contextSource='none'` |
>
> So with **both** a selection and a PDF `contentId`, an intervention prefers the selection, but the chatbot prefers the PDF. The chatbot's PDF path is page-windowed by `RAG_PAGE_WINDOW` (default 2) around `dto.currentPage` — a June-2026 fix (see `docs/BUG_REPORT_20260612.md`) after the chat path was found not to be page-aware.

---

## 2. Mode B — Pre-defined lessons with pre-uploaded PDFs (STANDARD)

- **Course builder** (`/teacher/courses/:courseId`, `CourseBuilderPage.tsx`) authors `CourseModule` → `ModuleItem`. `ModuleItemType` = `PAGE` (MDX/BlockDocument), `PDF` (blob), `LINK`, `ASSESSMENT` (`schema.prisma:67-72`).
- **Teacher RAG corpus:** teacher uploads → `SourceDocument` → `DocumentChunk` (teacher corpus), embedded with the teacher's key. A `ModuleItem` of type `PDF` links to its `SourceDocument` **by filename** (`pdfFilename`).
- **Grounding the chatbot/interventions on PDF lessons:** `tryResolveFromModuleItem` (`learning-interventions.service.ts:1321-1360`) — for a `PDF` item, matches the teacher `SourceDocument` by `pdfFilename` and joins its `DocumentChunk` content (capped 50 000 chars); for a `PAGE` item, extracts text from the block-document JSON in `contentMdx`. This teacher-corpus text becomes the `pdf-source` context for both the chatbot and the four interventions.
- **Contrast with Mode A:** dialogue mode grounds strictly on `StudentRagChunk` (student-owned, hard-scoped to `studentId`), so there is no cross-student or teacher-corpus leakage.

> **⚠ Stub:** `StudioOutputType.TIMELINE` (`schema.prisma:163`) is dead surface — `STUDIO_PROMPTS` (`dialogue/studio.service.ts:19-61`) has only 5 entries (no TIMELINE), and the internal DTO omits it. A TIMELINE request has no prompt or content schema.

---

## 3. The four learning interventions

Controller: `learning-interventions.controller.ts`. Service: `learning-interventions.service.ts` (~4360 lines). Prompt builders: `learning-interventions/prompts/*.ts`. Default prompts: `prompts/default-prompts.ts`.

### 3.1 Per-intervention summary

| | Practice Testing | Interrogative Elaboration | Stepwise Learning | Distributed Practice |
|---|---|---|---|---|
| **Generates** | Question set: MCQ + short-answer (default **3 MCQ + 2 short**) | Suggested "why/how" elaborative questions → tutor Q&A | 3–6 scaffolded steps, each with a comprehension check | Spaced-repetition flashcards |
| **Generate endpoint** | `POST /learning-interventions/practice-testing/generate` (`:1896`) | `POST /interrogative-elaboration/generate` (`:2456`) | `POST /stepwise-learning/generate` (`:2858`) | `POST /distributed-practice/generate` (`:3268`) |
| **Other endpoints** | `/:id/submit` (`:2310`), `GET /:id` | `/:id/ask` (`:2610`), `/:id/complete` (`:2749`) | `/:id/check` (`:3002`), `/:id/advance` (`:3130`), `/complete` | `GET /due` (`:3434`), `PATCH /cards/:id/review` (`:3465`), `GET /stats` |
| **Prompt builder** | `prompts/practice-testing.prompt.ts` | `prompts/interrogative-elaboration.prompt.ts` | `prompts/stepwise-learning.prompt.ts` | `prompts/distributed-practice.prompt.ts` |
| **Grading** | **Mixed**: MCQ deterministic, short-answer LLM (deterministic keyword fallback) | **None** (LLM "depth" summary only) | **LLM-graded** per step (no deterministic fallback) | **None** — student self-rates → SM-2 |
| **Persistence** | `LearningIntervention` (+ optional `SavedInterventionReview`) | `LearningIntervention` (+ saved) | `LearningIntervention` (+ saved) | `LearningIntervention` + one `SpacedRepetitionCard` per card (+ saved) |

### 3.2 sessionData shapes

- **Practice Testing** (`:2118-2127`): `{ questions: PracticeQuestion[], config: {mcqCount, shortAnswerCount, coverage, usedDefaults} }`; after submit adds `{ userAnswers, results, score }`.
- **Interrogative Elaboration** (`:2579-2586`): `{ suggestedQuestions[], keyConcepts[], conversation[], selectedText, questionsAsked }`; `conversation` USER turns carry per-turn `selectedText`/`currentPage`.
- **Stepwise** (`:2971-2977`): `{ steps[], summary, currentStep, selectedText, stepResults: Record<number,{attempts,passed,userResponses[]}> }`.
- **Distributed Practice** (`:3387`): `{ cards: {front,back}[] }`; the intervention is created with status `COMPLETED` immediately (`:3384`).

### 3.3 Grading logic (deterministic vs LLM)

- **Practice Testing** (`gradeAnswer`, `:3797`): MCQ normalised to a single `[A-D]` letter and compared deterministically; short-answer keyword fallback requires `matchedKeywords >= ceil(keywords.length/2)`. Non-empty short answers go to `gradeShortAnswerWithLlm` (`:3831`) with a hard-coded "be generous" check-prompt; on LLM failure it **falls back to deterministic**. Score = `round(correct/total × 100)`. **Caveat:** identical short answers can grade differently across runs (LLM non-determinism).
- **Stepwise** (`checkStepResponse`, `:3060`): LLM returns `{isCorrect, feedback, encouragement}`; on failure `feedback="We had trouble evaluating your answer"`. **After 2 failed attempts (`maxAttemptsAllowed=2`) the step is force-marked `passed=true`** so the student can proceed (`:3101-3103`).
- **Interrogative Elaboration:** no correctness scoring; completion produces an LLM `depthRating: surface|moderate|deep`.

### 3.4 Distributed Practice — SM-2 (verbatim constants)

`apps/api/src/learning-interventions/utils/sm2-algorithm.ts`. New cards seed `ease: 2.5, interval: 0, repetitions: 0, nextReviewAt: tomorrow` (`schema.prisma:1498`, service `:3404`).

Rating scale (`QUALITY_MAP`, `:14-19`):
```
again: 1,  hard: 2,  good: 3,  easy: 5      // note: quality 4 is never produced
```

Update rules (`calculateNextReview`, `:23-42`), quoted verbatim:
```js
if (quality >= 3) {
  if (repetitions === 0) interval = 1;
  else if (repetitions === 1) interval = 6;
  else interval = Math.round(interval * ease);
  repetitions += 1;
} else {
  repetitions = 0;
  interval = 1;
}
ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));
// nextReviewAt = today + interval days
```
- **Ease floor 1.3**; classic SM-2 EF delta `EF' = EF + (0.1 − (5−q)(0.08 + (5−q)·0.02))`.
- **Interval progression:** 1 → 6 → `round(interval × ease)`.
- **Failure (q < 3):** `repetitions=0`, `interval=1`.

> **Implementation note for the viva:** "hard" (q=2) is treated as a **full lapse** (resets repetitions & interval) — stricter than SM-2 variants that keep a shortened interval. Quality 4 is never emitted ("easy" jumps to 5). Stats bucketing: `repetitions===0`→new, `interval<21`→learning, else mature (`:3546`).

### 3.5 Text-highlight → LLM flow

1. **Selection capture (frontend), two producers:**
   - `PageContext.tsx:125-144` (PAGE lessons): on `mouseup`, `getSelection().toString().trim()`; **rejects if `length < 20`**, and the anchor must be inside a `[data-selectable="true"]` element.
   - `PdfReader.tsx:196-220` (PDF): on container `mouseup`; **rejects if `length <= 10`**, then `onTextSelected(text, currentPage)`. An `autoSelectCurrentPage` mode lifts the whole page's text-layer text.
2. **Payload:** each intervention view sends `selectedText` (+ `currentPage` for chat).
3. **Backend gate (authoritative):** `resolveInterventionContext` / `chat()` use `sel.length >= 20` to accept the selection as the grounding source; below 20 it falls back to PDF/RAG. The resolved `ctx.text` is dropped into `{{selectedText}}` of the prompt template. **The true selection→LLM threshold is 20 chars** (the PDF producer's 10-char gate only governs capture, not use).

### 3.6 Strategy-suggestion engine (chatbot)

The "heuristics" are **LLM-prompt instructions, not deterministic code**. The `chat()` persona (`:4214-4244`) instructs the model to append `[SUGGEST:STRATEGY_KEY]` on the last line "only when genuinely relevant", where `STRATEGY_KEY ∈ {PRACTICE_TESTING, DISTRIBUTED_PRACTICE, STEPWISE_LEARNING, INTERROGATIVE_ELABORATION}`. Mapping guidance: PRACTICE_TESTING (test/recall), DISTRIBUTED_PRACTICE (memorise long-term), STEPWISE_LEARNING (confused by dense material), INTERROGATIVE_ELABORATION (curious why/how).

Tag parsing is deterministic (`:4284-4292`):
```js
const strategyMatch = reply.match(/\[SUGGEST:(PRACTICE_TESTING|DISTRIBUTED_PRACTICE|STEPWISE_LEARNING|INTERROGATIVE_ELABORATION)\]/);
if (strategyMatch) { suggestedStrategy = strategyMatch[1]; reply = reply.replace(strategyMatch[0], '').trim(); }
```
The suggestion renders as a **clickable card** (`ChatbotPanel.tsx:738-765`); the intervention launches only when the **student clicks it** (`handleInterventionClick`). No suggestion ever auto-generates. The parsed value is persisted to `ChatbotMessage.suggestedStrategy` for later uptake analysis.

### 3.7 Teacher prompt customization (`InterventionPromptConfig`)

**Stored** (`schema.prisma:1468-1489`): `systemPrompt` (Text), `isCustom` (bool), and — **Practice Testing only** — `defaultMcqCount` / `defaultShortAnswerCount` (nullable Int). Unique per `(courseId, interventionType)`.

**Teacher-editable:** ONLY the per-type **system prompt** (validated to 50–10000 chars, warns non-blocking if it lacks JSON-format instructions, `:599-624`) plus Practice-Testing default counts (each [0,10], combined total [1,10]).

**Hard-coded (NOT editable):**
- The **user-prompt template** for all four generators (`DEFAULT_PROMPTS[type].userPromptTemplate`) — teacher edits never touch it.
- All grading/answer/summary prompts (`buildPracticeAnswerCheckPrompt`, `buildStepCheckPrompt`, `buildElaborationAnswerPrompt`, `buildConversationSummaryPrompt`).
- The chatbot persona and `[SUGGEST:…]` protocol; structural constants (count clamps, `maxAttemptsAllowed=2`, JSON schemas, SM-2 constants).

The system-vs-user split (`getSystemPrompt`, `:534`): if `customConfig?.isCustom && systemPrompt` → teacher's system prompt, else default. Placeholders (`{{mcqCount}}` etc.) are substituted into whichever system prompt is returned; `{{selectedText}}` is only ever substituted into the hard-coded user template.

---

## 4. Auto-trigger check — **CONFIRMED: interventions are never auto-triggered by affect/AU**

The claim holds. Evidence:

1. **Only two trigger reasons exist** in the entire service (grep of `triggerReason`): `'student_initiated'` and `'pre_generated'`. No `affect`, `boredom`, `auto`, or biometric reason anywhere.
2. **`ActivityAction.INTERVENTION_TRIGGERED` is a logging enum, not a trigger mechanism** — it is written *inside* the generate methods *after* the student's HTTP call (`:1953, 2161, 2504, …`).
3. **All four generate endpoints are invoked only from user-driven frontend actions** (the four intervention views' generate callbacks, or the chatbot's `[SUGGEST]` card the student clicks). No timer, observer, or biometric callback calls them.
4. **The affect/biometrics/AU pipeline is exclusively teacher-facing analytics** (OpenFace3 lanes, AffectiveStatCards, text-mining dashboards, ReplayTab). None reference the intervention service.
5. **The only cross-link runs the opposite direction:** `chat()` calls `textMining.ingest()` on the student's utterance (`:4046-4059`) to *feed* the teacher's text-mining dashboard. Affect data **consumes** chat; it never **triggers** an intervention.

**What actually triggers an intervention:** the student manually clicks a strategy button (optionally after highlighting text), OR clicks the chatbot's `[SUGGEST:X]` suggestion card (an LLM text suggestion the student explicitly accepts), then confirms config and generates. The `pre_generated` path serves cached exercises for the same student-initiated request.

> This is a **defensible design stance for the viva:** the affect layer is measurement-only, decoupled from the pedagogy loop, so there is no confound where the intervention itself is triggered by the very affective state you are measuring.
