# RAG Stage 01 — Ground-Truth Audit

> Snapshot date: **2026-06-02** • Stage 01 of the RAG upgrade plan
> (`prompts_rag/00_overview_and_recommendation.md`). This document is the
> ground-truth replacement for the second-hand description in the master
> plan. Every claim below is anchored to `file:line` in the working tree.
> No code in this stage changes; this is read-only audit + eval scaffold.

---

## 1. Teacher ingest + chunking path

Entry points live in `apps/api/src/rag/rag.service.ts` and the controller
`apps/api/src/rag/rag.controller.ts`.

### 1.1 Upload + trigger

- `RagController.uploadDocument` — `apps/api/src/rag/rag.controller.ts:59-71`
  POSTs multipart to `courses/:courseId/documents`, only `teacher`/`admin`.
- `RagService.uploadDocument` — `apps/api/src/rag/rag.service.ts:94-131`
  - Verifies course ownership (`:100-104`).
  - Writes blob to `BlobService` under key `rag/{courseId}/{ts}-{filename}`
    (`:106-111`).
  - Creates `SourceDocument` row (`:113-123`).
  - Fires `chunkDocument(doc.id)` **async + best-effort** (`:126-128`);
    progress is held in an in-memory `Map<string, DocumentProgress>` on the
    service (`:56-57`, `:177-179`). No queue, no retry on process restart.

### 1.2 Extraction + chunking

- `RagService.chunkDocument` — `apps/api/src/rag/rag.service.ts:181-271`
  - Downloads the blob, then calls `extractText` (`:273-303`):
    - **`text/plain` / `text/markdown`** → UTF-8 decode (`:277-279`).
    - **`application/pdf`** → `pdf-parse` (`PDFParse` class, loaded at
      call time via `require()` to dodge a DI caching bug — see
      `:69-90`). Returns `{ text, pageCount }`.
    - Other MIME → UTF-8 decode fallback (`:301-303`).
  - Chunks with `splitIntoChunks(text, strategy)` (`:305-318`):
    - `'PARAGRAPH'` strategy → `splitByParagraph` (`:320-343`), greedy
      pack-by-paragraph with a hard ceiling of **1500 chars per chunk**.
    - Otherwise → `splitByFixedSize` (`:345-366`), **`maxChunkSize=1000`
      chars / `overlap=200` chars** sliding window. `\f` page-break
      detection bumps `pageNum`.
  - `tokenCount` is a rough char/4 estimate (`:368-371`).
  - Wipes prior chunks (`:217`) then bulk-inserts via
    `prisma.documentChunk.createMany` (`:227`).

### 1.3 Embeddings — note: teacher chunks are NOT embedded

The teacher ingest pipeline writes `DocumentChunk` rows with **no
`embedding` column populated and no `embeddingModel` / `embeddingDimensions`
set**. There is no embedding call site in `RagService.chunkDocument`.
Confirm by reading the only insert at `apps/api/src/rag/rag.service.ts:219-225`
— only `documentId`, `chunkIndex`, `content`, `pageNumber`, `tokenCount`.

Retrieval over teacher chunks therefore runs keyword-only (see §3 below).

### 1.4 OpenAI Files API cache (for multimodal page-content generation)

After chunking, PDFs are uploaded to OpenAI's Files API
(`apps/api/src/rag/rag.service.ts:248-262`) via
`LlmService.uploadFileToOpenAi` (`apps/api/src/rag/llm.service.ts:801-851`).
The returned `file_id` is stored on the `SourceDocument`
(`openaiFileId`, `openaiFileUploadedAt`) so later multimodal calls reuse it.
This is **per-file**; not a per-chunk retrieval object.

### 1.5 `document_chunks` columns (Prisma model `DocumentChunk`)

`apps/api/prisma/schema.prisma:675-696`:

| Prisma field | DB column | Notes |
|---|---|---|
| `id` | `id` (uuid) | PK |
| `documentId` | `document_id` (uuid) | FK → `source_documents` (cascade) |
| `chunkIndex` | `chunk_index` (int) | Unique with `document_id` |
| `content` | `content` (text) | |
| `pageNumber` | `page_number` (int?) | |
| `tokenCount` | `token_count` (int) | Default 0 |
| `embedding` | `embedding` (jsonb?) | **Never populated by teacher ingest** |
| `embeddingModel` | `embedding_model` (text?) | Pinned at index time (currently null on teacher rows) |
| `embeddingDimensions` | `embedding_dimensions` (int?) | Pinned at index time |
| `createdAt` | `created_at` (timestamptz) | |

Indexes: `@@unique([documentId, chunkIndex])`, `@@index([documentId])`.

---

## 2. Student ingest + chunking path

### 2.1 Upload + dispatch

- `StudentRagService.uploadDocument` — `apps/api/src/student-rag/student-rag.service.ts:52-91`
  - Determines `StudentFileType` via `resolveFileType` (`:495-535`).
  - Persists to blob `student-docs/{studentId}/{courseId}/{ts}-{filename}`
    (`:62-68`).
  - Creates `StudentSourceDocument` row with `processingStatus='PENDING'`
    (`:71-85`).
  - Fires NestJS event `student-document.uploaded` (`:88`).
- `handleDocumentUploaded` — `apps/api/src/student-rag/student-rag.service.ts:95-98`
  Routes to `processDocument(documentId)`.

### 2.2 Parse → chunk → embed → persist

`StudentRagService.processDocument` — `apps/api/src/student-rag/student-rag.service.ts:217-380`:

1. Sets `processingStatus='PROCESSING'` and emits via gateway
   (`:238-245`).
2. Fetches blob (`:248`).
3. **Parse branch**:
   - If image MIME → `FileParserService.parseImageWithVision`
     (`:252-260`). This is the **vision-to-text flatten** the design doc
     referenced — but for **images only**, not PDFs (see §2.3).
   - Else → `FileParserService.parse` (`:262`).
4. Loads chunk options from `course.dblSettings` via Zod
   `DialogueCourseSettingsSchema` (`:270-274`). Defaults come from
   `@ats/shared` schema and are `chunkSize=512` tokens, `chunkOverlap=100`
   tokens (confirmed by `apps/api/src/student-rag/chunking.service.ts:4-7`,
   which is the consumer; the schema literal is in
   `apps/shared/src/dialogue-course-settings.ts`).
5. `ChunkingService.chunk(text, options, fileType)` —
   `apps/api/src/student-rag/chunking.service.ts:28-60`:
   - `chunkSizeChars = chunkSize * 4` (= 2048 for the 512-token default).
   - `overlapChars = chunkOverlap * 4` (= 400 chars).
   - Dispatches per file type:
     - `'MD'` → `chunkMarkdown` (heading-aware), `:64-105`.
     - `'CODE'` → `chunkCode` (function/class boundaries), `:109-167`.
     - `'PDF'`/`'DOCX'`/`'DOC'`/`'TXT'`/`'IMAGE_*'` →
       `chunkParagraphBased`, `:289-354`.
   - Then `applyOverlapAndFilter` (`:468-497`): prepends previous chunk's
     last `overlapChars` to each chunk, drops anything < `MIN_CHUNK_SIZE=50`
     (`:23`).
6. Wipes previous `StudentRagChunk` rows (`:284-286`).
7. `createMany` of chunks WITHOUT embeddings, with a lone-surrogate
   strip (`:290-302`).
8. Re-fetches with IDs (`:305-309`).
9. **Embedding** — calls `EmbeddingService.callEmbeddingForUser(teacherId,
   texts)` in `EMBEDDING_BATCH_SIZE=50` batches
   (`apps/api/src/student-rag/student-rag.service.ts:317-341`):
   - Updates each chunk's `embedding`, `embeddingModel`, `embeddingDimensions`
     (`:332-336`) — these are the pins the retrieval guard reads later.
10. Marks parent doc `processingStatus='COMPLETED'`,
    pins `embeddingModel`/`embeddingDimensions`, clears
    `needsReembed` (`:345-354`).
11. Emits `student-document.processed` for the source-guide pipeline
    (`:361`).
12. On any failure → `processingStatus='FAILED'`, stores
    `processingError` (`:364-379`).

### 2.3 Where the "vision-to-text flatten" actually happens

**Design doc was off-by-target** (see §7 Diffs). The reference to
`student-rag.service.ts:136-144` lands inside the `reembedDocument`
re-embed worker (`:130-144`), NOT the OCR path. The actual flatten lives
in **`apps/api/src/student-rag/file-parser.service.ts:210-252`**
(`parseImageWithVision`), and is only invoked for image MIME types in
`StudentRagService.processDocument:252-260`. **PDFs go through
`pdf-parse` text extraction at `file-parser.service.ts:110-135`** — the
visual content is not flattened via vision; it is silently dropped (only
the text layer survives). That's the actual modality-loss site in the
current student pipeline.

### 2.4 Re-embed worker (Stage 3.4 funnel + retrieval guard)

`reembedDocument` — `apps/api/src/student-rag/student-rag.service.ts:118-187`:
- Listens to `student-document.needs-reembed`.
- Walks chunks, re-calls `callEmbeddingForUser`, updates per-chunk
  `embedding`/`embeddingModel`/`embeddingDimensions`, clears
  `needsReembed` on the doc.
- `handleReembedTeacher` / `reembedAllPendingForTeacher` at `:189-215`
  is the batch fan-out triggered when the teacher saves a new embedding
  model in Settings (event emitted from `LlmService` —
  `apps/api/src/rag/llm.service.ts:400-402`).

### 2.5 Embedding funnel — `apps/api/src/student-rag/embedding.service.ts`

- `resolveTeacherEmbeddingSpec(teacherId, outputDimensions?)` —
  `:46-81`. Reads `User.llmProvider` + `User.llmEmbeddingModel`,
  looks up the registry spec, decrypts the key, returns
  `{ apiKey, provider, spec, outputDimensions }`. Provider mismatch
  defensively falls back to the provider's registry default (`:62`).
- `callEmbeddingForUser(teacherId, texts, options?)` —
  `:89-151`. Public entry. Picks dim via `pickOutputDimension` (`:229-240`),
  no-key → fallback path (`:109-117`), else `embedOpenAI`/`embedGemini`.
  Provider failure → SHA256 fallback **with a logged error** at `:138-150`.
- `embedWithSpec(texts, apiKey, provider, spec, outputDimensions?)` —
  `:171-203`. Used by the retrieval guard to re-embed the query against
  the corpus's PINNED model.
- Legacy `embed(texts, apiKey, provider)` — `:213-220`. Still used by
  `student-rag-retrieval.service.ts:290` as the "legacy path" when the
  pinned model is unknown to the registry.
- **SHA256 pseudo-vector fallback** — `generateFallbackEmbedding` —
  `:333-363`. Word-bag hash mapped onto `dimension` slots, normalised.
  Called from `:110`, `:143`, `:183`, `:200`. **This is the silent
  quality-collapse path the Stage 02 prompt targets.**
- Encrypted-key decrypt — `:367-377`. AES-256-GCM with key derived from
  `JWT_SECRET`.

`@@map`/snake_case columns confirmed earlier in §1.5; same scheme on
`student_rag_chunks` (§6).

---

## 3. Shared retriever — `apps/api/src/student-rag/student-rag-retrieval.service.ts`

### 3.1 Public entry

`StudentRagRetrievalService.retrieve(query, studentId, courseId,
activeSourceIds, topK, apiKey, provider, teacherId?)` — `:142-187`:

1. Empty `activeSourceIds` → `[]`.
2. Runs `denseRetrieval` (limit `topK*2`) and `sparseRetrieval` (limit
   `topK`) in parallel (`:155-167`).
3. RRF-merges via `reciprocalRankFusion` (`:170`).
4. Resolves document names (`:173-178`).
5. Dedupes via `deduplicateChunks` (`:181`) — Jaccard > 0.9 on
   word-set, `:431-444`.
6. Returns top `topK`.

### 3.2 Dense path — `:204-319`

- Reads all eligible chunks **into memory**, filters by `embedding NOT
  JsonNull` (`:215-232`).
- Groups by pinned `(embeddingModel, embeddingDimensions)` (`:239-247`).
  Missing pin → bucketed under legacy `text-embedding-ada-002 / 1536`
  (`:241-243`).
- For each group:
  - Re-embeds the query with the GROUP's spec via
    `embeddingService.embedWithSpec` (`:262-285`). On dim mismatch,
    skips the group rather than scoring (`:275-280`).
  - Falls back to legacy `embedOne(query, apiKey, provider)` if the
    pinned spec isn't in the registry (`:288-291`).
  - **Cosine in JS** (`:294-311`); a hard refuse on mismatched-length
    vectors (`:297-300`).
- Returns top `limit` after sort.

### 3.3 Sparse path — `:323-389`

- Tokenizes query, drops stopwords (set at `:18-129`) and tokens
  ≤2 chars.
- Postgres `findMany` with `OR: [ {content: { contains: term, mode:
  'insensitive' }}, ... ]` (`:341-358`). **Yes — it's literal
  `ILIKE`-style; no `tsvector`/`tsquery`, no BM25 in the DB.**
- In-memory BM25-ish scoring (`:361-382`) with the constant
  `0.75 * len / 2000` length normaliser at `:371`. **NOT real BM25**,
  but close enough.
- Returns top `limit`.

### 3.4 RRF — `:393-427`

`RRF_K = 60` constant at `:131`. Standard formula `1/(k + rank + 1)`,
both lists scored, sorted by sum, sliced to `topK*2` (so dedupe can drop
without starving final).

### 3.5 Callers — **NONE in production code**

Audit finding: `StudentRagRetrievalService` is registered in
`student-rag.module.ts:30` and exported (`:36`), but the only callers
are the three test instantiations in
`apps/api/src/student-rag/student-rag-retrieval.service.spec.ts:123,182,229`.

The two production retrieval sites use their **own ad-hoc keyword
scorers**:

- `DialogueService.retrieveStudentChunks` —
  `apps/api/src/dialogue/dialogue.service.ts:487-536`. Pulls all chunks,
  applies token-count scoring with `score / sqrt(len/100)`
  normalisation. **No embeddings, no sparse-ILIKE OR, no RRF.**
- `LearningInterventionsService.queryStudentRagChunks` —
  `apps/api/src/learning-interventions/learning-interventions.service.ts:706-773`.
  Same shape; literally a copy with an extra "MAX_CHARS=500" snippet
  cap.

The "Per-pinned-group re-embed" logic referenced in the task prompt and
verified at §3.2 above IS implemented in the shared retriever, but
nothing in production calls it. Stage 02 (unify retrieval substrate) is
therefore a much bigger lift than the design doc implies; Stage 02 must
delete the two ad-hoc scorers and route both surfaces through this
service.

### 3.6 Top-k defaults

- Dialogue: `dblSettings.topKChunks` (Zod default in
  `@ats/shared/dialogue-course-settings`); passed into
  `retrieveStudentChunks` at `dialogue.service.ts:161`.
- Interventions: hard-coded `top.slice(0, 5)` at
  `learning-interventions.service.ts:760`.
- `StudentRagRetrievalService.retrieve` would accept a `topK` from the
  caller; the spec test asserts on `topK=5`.

---

## 4. LLM funnel — `apps/api/src/rag/llm.service.ts`

### 4.1 Public entry points

- **`callLlmForUser(userId, systemPrompt, userPrompt, usageContext?, options?)`**
  — `apps/api/src/rag/llm.service.ts:702-726`. Simple wrapper that
  forwards into `callLlmStructured` with a single user-string message.
- **`callLlmStructured(userId, request, usageContext?)`** —
  `:737-775`. Registry-driven funnel. Resolves credentials via
  `getUserApiKey` (`:236-254`), calls `callLlm` (`:919-970`), records
  `llmUsageLog` for cost tracking. Returns
  `{ content, promptTokens, completionTokens, model, provider }`.
- **`callLlm(request, credentials)`** — `:919-970`. Branch:
  - No credentials → `generateWithoutApi` template fallback (`:932-934`,
    body at `:1163-1191`). This is the template-fallback site for the
    `learning-interventions.service.ts:~599` reference in the master
    plan — see §7.
  - Else, resolves `ChatModelSpec` via `getChatModel` (`:938`, with
    `defaultChatModel(provider)` defensive fallback at `:943`).
  - Calls `callOpenAiApi` (`:991-1066`) or `callGeminiApi` (`:1070-1161`).
  - On JSON-mode provider failure, **re-throws** (`:965`) so the caller
    can retry (this is the bug-fix for "silent template fallback eats
    Gemini JSON"). Non-JSON: degrades to template (`:967-968`).

### 4.2 Provider resolution

`getUserApiKey(userId)` — `:236-254`. Reads `User.llmProvider`,
`User.llmModel`, decrypts `User.encryptedApiKey`, then **runs the
read-time guard** `resolveChatModelWithGuard(provider, storedModel,
userId)` (`:273-296`). The guard substitutes the registry default when
the stored model is missing / wrong-provider / retired and logs to
console (`:291-294`). Defaults from `model-registry.ts:`:

- OpenAI default chat: **`gpt-5.4-mini`** (`apps/api/src/llm/model-registry.ts:84`).
- Gemini default chat: **`gemini-3.5-flash`** (`:138`).
- OpenAI default embedding: **`text-embedding-3-small`** dim 1536
  (`:202-205`).
- Gemini default embedding: **`gemini-embedding-001`** dim 768
  (`:232-235`).

### 4.3 SHA256 pseudo-vector fallback site

The SHA256 fallback the design doc calls out is **not** in `llm.service.ts`
at `:430` — that line is inside `generateRagAnswer`. The fallback lives
in `EmbeddingService.generateFallbackEmbedding`
(`apps/api/src/student-rag/embedding.service.ts:333-363`), invoked at
`:110, :143, :183, :200` (no-key path + provider-error degradation). The
design doc mis-attributed the file (see §7).

### 4.4 Template fallback in interventions

The "if LLM call fails, fall back to a template" pattern in
`learning-interventions.service.ts`:

- Practice testing: `:824-852` — retries up to `maxAttempts=2`, throws on
  exhaustion (`:847`). No silent template fallback at the intervention
  layer; the funnel's own template fallback at
  `llm.service.ts:932-934` (no-key) and `:967-968` (non-JSON provider
  error) is what runs.
- The same retry/throw shape repeats for interrogative-elaboration
  generation (`:1072-1099`-ish), stepwise (`:1355-1380`), distributed
  practice (`:1714-1740`). All four pass `jsonMode: true` +
  `jsonSchema`, so a provider error re-throws (per `:965`).

So when the design doc says "template fallback in interventions at
`:~599`", the actual behavior in the merged tree is **the funnel's
keyless template fallback**, not an intervention-layer one. See §7.

### 4.5 Multimodal / OpenAI Files

- `uploadFileToOpenAi(userId, filename, buffer, mimeType?)` — `:801-851`.
  Uses `purpose='user_data'`, returns `file_id` or `null`. Only used on
  PDFs at ingest time (`rag.service.ts:248-262`).
- `deleteFileFromOpenAi(userId, fileId)` — `:858-875`. Best-effort on
  `SourceDocument` delete (`rag.service.ts:166-168`).
- `getResolvedChatModelForUser(userId)` — `:783-791`. Used by
  `page-content.service.ts` to branch on
  `spec.supportsOpenAiFilesApi`.

### 4.6 Funnel content-part types

- `FunnelMessage` / `FunnelContentPart` — `:78-95`. Three part types:
  `text`, `file` by OpenAI `file_id`, `file` inline (`filename` +
  `file_data` base64). Gemini translation at `:1110-1129` drops
  OpenAI-file-id parts.

---

## 5. Dispatch surfaces — system-prompt sites

Every place a system/grounding prompt string lives. Stage 06 unifies
these.

### 5.1 Floating/docked chatbot (`learning-interventions.service.ts`)

- **`chat()` system prompt** —
  `apps/api/src/learning-interventions/learning-interventions.service.ts:2496-2521`.
  Defines the strategy-suggesting chatbot persona + `[SUGGEST:X]`
  protocol; `${courseContext}` interpolated from the three-source
  fallback at `:2443-2476`.
- **`resolveInterventionContext()`** —
  `learning-interventions.service.ts:568-645`. The fallback chain
  (selection → PDF source → student RAG). Used by all four generators
  (`:805`, `:1049`, `:1337`, `:1696`) but **not** by `chat()` which
  inlines a similar but distinct chain at `:2443-2476`.

### 5.2 Four intervention generators (each has its own prompt builder)

- **Practice Testing**:
  - Default system prompt:
    `apps/api/src/learning-interventions/prompts/default-prompts.ts:15-43`
    (key `PRACTICE_TESTING`).
  - Per-course override fetched at `learning-interventions.service.ts:815`
    (`getSystemPrompt`).
  - Builder: `apps/api/src/learning-interventions/prompts/practice-testing.prompt.ts:3-15`.
  - Answer-check prompt: same file, `:21-` (`buildPracticeAnswerCheckPrompt`).
- **Interrogative Elaboration**:
  - Default: `default-prompts.ts:47-` (key `INTERROGATIVE_ELABORATION`).
  - Per-course at `learning-interventions.service.ts:1061`.
  - Builders in `prompts/interrogative-elaboration.prompt.ts` —
    `buildQuestionSuggestionPrompt`, `buildElaborationAnswerPrompt`,
    `buildConversationSummaryPrompt`.
- **Stepwise Learning**:
  - Default: `default-prompts.ts` (key `STEPWISE_LEARNING`).
  - Per-course at `learning-interventions.service.ts:1346`.
  - Builders in `prompts/stepwise-learning.prompt.ts` —
    `buildStepwiseLearningPrompt`, `buildStepCheckPrompt`.
- **Distributed Practice**:
  - Default: `default-prompts.ts` (key `DISTRIBUTED_PRACTICE`).
  - Per-course at `learning-interventions.service.ts:1706`.
  - Builder in `prompts/distributed-practice.prompt.ts` —
    `buildDistributedPracticePrompt`.
- Prompt-preview path (teacher Settings): `:524-549`.
- Storage: `InterventionPromptConfig` Prisma model, upserted at `:484-499`.

### 5.3 Dialogue mode (`dialogue.service.ts`)

- **`sendMessage()`** — `apps/api/src/dialogue/dialogue.service.ts:116-275`.
  Resolves `activeSourceIds`, retrieves with own keyword scorer
  (`:487-536`), builds `ragContext` (`:165-170`), calls
  `buildSystemPrompt(dblSettings, ragContext)` (`:347-378`) which composes:
  - The teacher `systemPromptOverride` OR the hard-coded "intelligent
    learning assistant" baseline (`:348-352`).
  - A citation-mode instruction (`:354-359`).
  - A Markdown/GFM/KaTeX formatting block (`:366-371`).
  - The retrieved-chunks context (`:373-375`).
- Title auto-gen prompt: `:439-444`.

### 5.4 Other prompt sites surfacing across the codebase

For completeness — Stage 06 will need to decide which of these get the
unified grounded contract:

- `apps/api/src/page-content/page-content.service.ts:231` —
  `buildPageContentSystemPrompt(strictSources)`. Strings live in
  `apps/api/src/page-content/page-content-prompts.ts`.
- `apps/api/src/curriculum-coverage/curriculum-coverage.service.ts:304, 417` —
  `buildSyllabusParserSystemPrompt`, `buildOutcomeMappingSystemPrompt`.
- `apps/api/src/course-structure/course-structure.service.ts:206` —
  `buildStructureSystemPrompt`. Strings in
  `apps/api/src/course-structure/prompts.ts`.
- `apps/api/src/evaluation/evaluation.service.ts:476` —
  `buildEvaluationSystemPrompt(config)`.
- `apps/api/src/kc/kc-suggestion.service.ts:53` —
  `buildKcExtractionSystemPrompt`.
- `apps/api/src/kc/kc-graph.service.ts:102` —
  `buildGraphGenerationSystemPrompt`.
- `apps/api/src/question-generation/question-generation.service.ts:216, 411, 483` —
  `QUESTION_GENERATION_PROMPT.systemPrompt` (+ `getFeedbackPrompt`).
- `apps/api/src/student-rag/file-parser.service.ts:219` — OCR vision
  prompt (image flatten).
- `apps/api/src/student-rag/student-source-guide.service.ts:85` —
  Source-guide generator.
- `apps/api/src/dialogue/guide-generation.poller.ts:83` —
  Background source-guide poller.
- `apps/api/src/text-mining/detection/detection.service.ts` and
  `apps/api/src/text-mining/prompts/prompts.service.ts` — EF detection.
- `apps/api/src/rag/llm.service.ts:415, 511, 1260-1276, 1278-1299` —
  In-service `buildRagSystemPrompt(strictSource)` and
  `buildContentGenerationPrompt(strictSource)`.

**Total system-prompt sites in scope for Stage 06: ~16 distinct
builders/strings.** The four intervention defaults + the
floating-chatbot prompt + the dialogue-mode prompt are the "user-facing
retrieval surfaces" that the unified grounded contract must cover.

---

## 6. Prisma schema — relevant models

Source: `apps/api/prisma/schema.prisma`. House rule: PascalCase models
→ snake_case columns via `@map`; lowercase models keep camelCase.

### 6.1 `SourceDocument` — `:633-673` → `@@map("source_documents")`

Key columns:
- `id` `uuid` PK.
- `courseId` `course_id` `uuid`, FK → `courses`.
- `uploadedById` `uploaded_by_id` `uuid`, FK → `users`.
- `title`, `filename`, `blobKey` `blob_key`, `mimeType` `mime_type`,
  `sizeBytes` `size_bytes`, `pageCount` `page_count`.
- `chunkingStrategy` `chunking_strategy` enum `ChunkingStrategy`
  default `PARAGRAPH`.
- `chunkCount` `chunk_count` int default 0.
- `indexedAt` `indexed_at` timestamptz.
- `openaiFileId` `openai_file_id` text, `openaiFileUploadedAt`
  `openai_file_uploaded_at` timestamptz.
- `embeddingModel` `embedding_model` text, `embeddingDimensions`
  `embedding_dimensions` int, `needsReembed` `needs_reembed` bool
  default false. (Stage 2 LLM upgrade.)
- Relations: `course` (cascade delete), `uploadedBy`, `chunks`.
- Indexes: `@@index([courseId])`.

### 6.2 `DocumentChunk` — `:675-696` → `@@map("document_chunks")`

See §1.5. Note `embedding` is `Json?`, **not** `vector`; pgvector is not
in use.

### 6.3 `StudentSourceDocument` — `:700-736` → `@@map("student_source_documents")`

- `id` cuid PK (NOT uuid — student-side tables use cuid).
- `enrollmentId`, `studentId`, `courseId` (all `@db.Uuid`),
  `sessionId` cuid nullable, FK → `dialogue_sessions` ON DELETE SET NULL.
- `fileName`, `originalName`, `mimeType`, `fileSize`, `blobKey`,
  `fileType` (enum `StudentFileType`).
- `processingStatus` enum `DocumentProcessingStatus`, `processingError`
  text.
- `isActive` bool default true.
- Stage 2 pin: `embeddingModel`, `embeddingDimensions`, `needsReembed`.
- Relations: `enrollment` cascade, `student`, `course`, `session` set
  null, `autoGuide`, `chunks`, `dialogueNotes`.

### 6.4 `StudentRagChunk` — `:752-772` → `@@map("student_rag_chunks")`

- `id` cuid PK.
- `documentId` cuid, FK → `student_source_documents` cascade.
- `studentId`, `courseId` `@db.Uuid`.
- `content` text, `embedding` Json nullable, `embeddingModel`,
  `embeddingDimensions`.
- `chunkIndex` int, `pageNumber` int?, `metadata` Json?.
- Indexes: `@@index([documentId])`, `@@index([studentId, courseId])`.

### 6.5 `DialogueMessage` — `:797-809` → `@@map("dialogue_messages")`

- `id` cuid, `sessionId` cuid FK → `dialogue_sessions` cascade.
- `role` `MessageRole` enum, `content` text, `citations` Json?,
  `tokenUsage` Json? `token_usage`.
- Index: `@@index([sessionId])`.

### 6.6 `ChatbotMessage` — `:834-879` → `@@map("chatbot_messages")`

- `id` uuid PK.
- `studentId` uuid FK → `users` cascade. **Owner key** — survives
  session teardown.
- `studentSessionId` uuid nullable, FK → `student_sessions` SET NULL.
- `courseId` uuid?, `moduleItemId` uuid?.
- `role` enum, `content` text, `contextSource` `context_source` text
  (`'pdf-source' | 'selection' | 'student-rag' | 'none'`), `selectedText`
  text, `suggestedStrategy` text, `promptTokens`/`completionTokens`/
  `model` for usage tracing.
- Indexes: `@@index([studentSessionId])`,
  `@@index([studentSessionId, createdAt])`,
  `@@index([studentId, createdAt])`.

---

## 7. Diffs from design doc (`00_overview_and_recommendation.md`)

The design doc has minor line-number drifts and one substantive
modeling error. Flagging each so later stages can be corrected:

1. **`apps/api/src/rag/rag.service.ts:181+`** ("Fixed-size sliding
   window"). Confirmed at `:181-271` for the orchestration, with the
   actual splitter at `:345-366`. Defaults are
   **`maxChunkSize=1000 chars / overlap=200 chars`** (§1.2), not "fixed
   size" of unspecified width. Note also the `PARAGRAPH` default
   (`ChunkingStrategy` Prisma default is `PARAGRAPH`,
   `schema.prisma:643`), which means most teacher docs actually go
   through `splitByParagraph` (§1.2), **not** the fixed-size path the
   table implies.

2. **`apps/api/src/student-rag/chunking.service.ts:28-60`** ("Context-
   aware 512-token / 100-token overlap"). Confirmed at `:28-60`. 512/100
   are the **token** defaults; the implementation multiplies by
   `CHARS_PER_TOKEN=4` (`:24`) to get `2048/400` char windows. Branches
   by `StudentFileType`, not a single context-aware splitter (§2.2).

3. **`apps/api/src/student-rag/embedding.service.ts:48-49,85`** (key
   load sites). Confirmed:
   - `:46-81` `resolveTeacherEmbeddingSpec` (decrypts key, picks
     spec). The cited `:48-49,85` lines have drifted; the relevant
     anchors are now `:46-49` (function header) and `:89-151`
     (`callEmbeddingForUser`).

4. **`apps/api/src/student-rag/student-rag-retrieval.service.ts:130,310-345`**
   ("top-k 8" / RRF). Confirmed at `:131` (`RRF_K = 60`), `:393-427`
   (RRF). The top-k default is **not 8** — it's the caller-passed `topK`
   from `dblSettings.topKChunks`, and there's no global default in the
   retrieval service itself. The "top-k 8" claim is wrong; it's
   `topK=5` for interventions
   (`learning-interventions.service.ts:760`) and Zod-schema-driven for
   dialogue.

5. **`apps/api/src/rag/llm.service.ts:430`** (`callLlmForUser`).
   **Wrong line.** `callLlmForUser` is at `:702-726`, and is now a
   wrapper around `callLlmStructured` at `:737-775` (added in Stage
   3.2). The line-430 region of the file is inside `generateRagAnswer`,
   not the funnel. §4.

6. **SHA256 pseudo-vector fallback "at llm.service.ts"**. **Wrong file.**
   The fallback lives in `embedding.service.ts:333-363`
   (`generateFallbackEmbedding`), called from `:110, :143, :183, :200`.
   `llm.service.ts` has no SHA256 path. §4.3.

7. **`apps/api/src/learning-interventions/learning-interventions.service.ts:436`**
   (`resolveInterventionContext`). **Drifted.** The function is now at
   `:568-645`. The "main" intervention-context resolver also has a
   **standard-mode PDF branch** at `:595-600` that the design doc
   doesn't mention.

8. **`learning-interventions.service.ts:2198-2350`** (`chat()`).
   **Drifted.** The chatbot `chat()` is at `:2393-2629`, with the
   system prompt literal at `:2496-2521`. The grounding fallback chain
   (PDF → selection → student-RAG) at `:2443-2476` is distinct from
   `resolveInterventionContext()` despite covering the same three
   sources — Stage 06 must unify these two.

9. **`student-rag.service.ts:136-144`** ("OCR/vision-to-text flatten").
   **Wrong section.** Lines `:130-144` are the **re-embed worker** body,
   not OCR. The flatten happens in **`file-parser.service.ts:210-252`**
   (`parseImageWithVision`) and is **only called for image MIME types**
   in `student-rag.service.ts:252-260`. **PDFs do NOT get vision
   flattened** — they go through `pdf-parse` text extraction at
   `file-parser.service.ts:110-135`, which silently drops images,
   charts, and figures. The "visual fidelity lost" claim is correct,
   but the mechanism is **text-only PDF parsing**, not vision flatten.
   This matters for Stage 05 design.

10. **"shared retrieval library"**. **Modeling error.** The master plan
    table says teacher and student retrieval "shared hybrid: dense
    cosine + ILIKE + RRF". In reality, `StudentRagRetrievalService` is
    **never called** in production (§3.5). Both the dialogue path and
    the chat/intervention path use their own ad-hoc keyword-only
    scorers (`dialogue.service.ts:487-536`,
    `learning-interventions.service.ts:706-773`). Teacher RAG
    (`rag.service.ts:375-422` `queryChunks`) is also keyword-only, with
    no dense path at all. Stage 02 must (a) wire dialogue + chat +
    interventions through `StudentRagRetrievalService`, AND (b)
    introduce a teacher-side retrieval service or extend the existing
    one to cover `DocumentChunk`. The shared substrate is **a design
    goal, not the current state**.

11. **Teacher chunks have no embeddings**. The master plan table claims
    teacher chunks are embedded with the same OpenAI/Gemini funnel as
    student chunks. **They aren't.** `rag.service.ts:181-271` writes
    `DocumentChunk` rows without an `embedding` column populated (§1.3).
    `embeddingModel`/`embeddingDimensions` stay null on teacher rows.
    Stage 02 must either backfill or call `callEmbeddingForUser` during
    `chunkDocument`.

12. **`embedding.service.ts` legacy fallback dim** is hard-coded to
    `1536` (`student-rag-retrieval.service.ts:241-243`), matching the
    legacy `text-embedding-ada-002`. With the registry default now
    `text-embedding-3-small` (also 1536) this is benign, but if the
    teacher switches to `text-embedding-3-large` (3072) or
    `gemini-embedding-001` (768), legacy un-pinned rows will be skipped
    in the retrieval guard. Stage 02 must backfill the
    pin columns on existing rows.

---

## 8. Headline numbers (for Stage 02 planning)

| Surface | Path | Current state |
|---|---|---|
| Teacher ingest | `rag.service.ts:181-271` | Paragraph or fixed-size text split, **no embeddings** |
| Teacher retrieval | `rag.service.ts:375-477` | Keyword-only TF-ish + simulated reranker |
| Student ingest | `student-rag.service.ts:217-380` | File-type-branched chunker @ 512/100 tokens, embedded via funnel |
| Student retrieval (designed) | `student-rag-retrieval.service.ts:142-187` | Hybrid dense+sparse+RRF — **unused in prod** |
| Student retrieval (actual: dialogue) | `dialogue.service.ts:487-536` | Keyword-only |
| Student retrieval (actual: chat/intervention) | `learning-interventions.service.ts:706-773` | Keyword-only |
| LLM funnel | `llm.service.ts:702-775` | Registry-driven, OpenAI + Gemini, JSON-mode aware |
| Embedding funnel | `embedding.service.ts:89-151` | Registry-driven; SHA256 fallback at `:333-363` |
| Prompt sites (audit-relevant) | §5 | 6 user-facing surfaces, ~16 builders total |

Eval harness (Stage 01 §B) is rooted at
`apps/api/src/rag/eval/` and runs end-to-end through these paths. See
`apps/api/src/rag/eval/README.md` once the runner ships in this PR.

---

## 9. Stage 02 changes (2026-06-03)

Stage 02 (`prompts_rag/02_unify_text_retrieval_substrate.md`) landed in
the working tree on **2026-06-03**. Key file-level deltas vs the §1-§7
audit above:

### 9.1 Single shared chunker
- New: `apps/api/src/rag/shared/chunking.service.ts` —
  `SharedChunkingService.chunkDocument(text, opts)`. Defaults: 512
  tokens, 100-token overlap, MIN_CHUNK_SIZE=50, lone-surrogate strip
  preserved.
- Teacher path (`rag.service.ts:chunkDocument`) now calls
  `sharedChunking.chunkDocumentWithPages(...)`. The previous
  `splitIntoChunks`/`splitByParagraph`/`splitByFixedSize` helpers were
  deleted.
- Student path: `apps/api/src/student-rag/chunking.service.ts` is now a
  thin shim delegating to the shared module (same `chunk(text, opts,
  fileType)` signature preserved for `StudentRagService.processDocument`).

### 9.2 Teacher embeddings wired (closes §1.3 audit gap)
- `rag.service.ts:chunkDocument` now calls
  `embeddingService.callEmbeddingForUser(teacherId, batch)` in
  EMBEDDING_BATCH_SIZE=50 batches and persists
  `embedding`/`embeddingModel`/`embeddingDimensions` per
  `document_chunks` row.
- Gated by env flag `RAG_TEACHER_EMBEDDINGS` (default `true`).
- Failure of one batch does NOT abort ingest — the chunks stay
  text-only; retrieval falls back to keyword.

### 9.3 Pseudo-embedding gate (Stage 02 Task E)
- `EmbeddingService` SHA256 fallback now:
  - logs `console.warn` with reason every invocation;
  - tags affected chunks with sentinel `embeddingModel = 'sha256-pseudo'`
    (exported as `PSEUDO_EMBEDDING_MODEL`);
  - throws `RAG_PSEUDO_EMBEDDING_BLOCKED` when
    `pseudoEmbeddingsAllowed()` returns false. Default policy: allow in
    `NODE_ENV !== 'production'`, block in prod. Override with
    `RAG_ALLOW_PSEUDO_EMBEDDINGS=true|false`.

### 9.4 Embedding versioning
- New nullable column `embedding_version TEXT` on
  `source_documents`/`document_chunks`/`student_source_documents`/`student_rag_chunks`
  (migration `20260603000000_add_embedding_version`). Stays NULL today;
  reserved for Stage 05 multimodal rollups and future model rollouts
  where the model id alone is insufficient to differentiate vector
  variants.

### 9.5 Mixed-index warning + `RetrievalResult`
- `StudentRagRetrievalService.retrieveWithMeta(...)` (new): returns
  `{ chunks, meta }` where `meta` includes
  `mixedIndexChunkCount`/`degradedRetrieval`/`pinnedSpecs`.
- Logs `console.warn("[RAG] mixed embedding index ...")` when the
  corpus has > 1 pinned spec, and `console.warn("[RAG] degraded
  retrieval ...")` when any chunk uses the pseudo sentinel.
- Legacy `retrieve(...)` preserved as a thin shim returning just the
  chunk list (used by tests).

### 9.6 Shared retriever wired into production surfaces
The audit's §3.5 finding ("nobody calls `StudentRagRetrievalService` in
prod") is closed:
- `dialogue.service.ts:retrieveStudentChunks` now calls
  `studentRagRetrieval.retrieveWithMeta(...)`. Legacy keyword scorer
  preserved as `retrieveStudentChunksKeywordLegacy` and used as
  fallback when corpus has no embeddings.
- `learning-interventions.service.ts:queryStudentRagChunks` likewise.
- `rag.service.ts:queryChunksFiltered` (and via that,
  `queryChunks`) now calls
  `studentRagRetrieval.retrieveTeacher(...)` — a new teacher-side
  hybrid (dense + sparse + RRF) method added in the shared retriever.
  Keyword path preserved as `queryChunksKeywordLegacy`.
- All three are gated by env flag `RAG_USE_SHARED_RETRIEVER` (default
  `true`) for instant rollback.

### 9.7 Maintenance: reindex-embeddings.ts
`apps/api/prisma/scripts/reindex-embeddings.ts` — idempotent batched
re-embed of chunks whose `embedding_model` differs from the teacher's
active default. Run:

```
pnpm --filter @ats/api exec tsx prisma/scripts/reindex-embeddings.ts
pnpm --filter @ats/api exec tsx prisma/scripts/reindex-embeddings.ts -- --dry-run
pnpm --filter @ats/api exec tsx prisma/scripts/reindex-embeddings.ts -- --course=<uuid>
```

Triggered after:
- a teacher switches `User.llmEmbeddingModel` and the per-doc
  `needs_reembed` flag picks up the new pin only on the next ingest
  cycle (the script catches the in-flight gap);
- a bulk legacy backfill (e.g. consolidating all `text-embedding-ada-002`
  rows onto `text-embedding-3-small`).

### 9.8 Stage 02 feature flags (summary)

| Env var | Default | Behavior |
|---|---|---|
| `RAG_TEACHER_EMBEDDINGS` | `true` | Wire teacher chunks through the embedding funnel during ingest. Setting `false` skips the step and leaves chunks text-only (legacy behaviour). |
| `RAG_USE_SHARED_RETRIEVER` | `true` | Use `StudentRagRetrievalService` from dialogue / interventions / teacher RAG. Setting `false` falls back to the per-surface keyword scorers. |
| `RAG_ALLOW_PSEUDO_EMBEDDINGS` | `true` in dev/test, `false` in prod | When `false`, the SHA256 pseudo-vector fallback throws `RAG_PSEUDO_EMBEDDING_BLOCKED` instead of silently returning a degraded vector. |
