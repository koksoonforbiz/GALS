# LLM Call-Site Audit — Stage 1

**Date:** 2026-06-02
**Scope:** Every place the GALS platform talks to an LLM / embedding API across `apps/api` and `apps/web`.

This is the read-only deliverable for Stage 1. It enumerates every chat, embedding, vision and file-upload call site, marks whether it goes through the shared funnel `LlmService.callLlmForUser()` (`apps/api/src/rag/llm.service.ts:430`), and flags every hard-coded model string, provider assumption and bypass.

---

## Summary counts

| Metric | Count |
|---|---|
| **Total chat call sites** (one logical request to a chat/completion endpoint) | **27** |
| Chat call sites that route through `callLlmForUser` | **20** |
| Chat call sites that BYPASS the funnel (raw `fetch` / own provider switch) | **7** |
| **Embedding call sites** | **3** (1 OpenAI, 1 Gemini, 1 hashing fallback — all inside one service) |
| **OpenAI Files API call sites** (multimodal cache) | **3** (upload, delete, consume in page-content) |
| **Hard-coded model strings** in source (excluding tests + the registry to be added) | **17** |
| Files where the user's `llmProvider` is read but Gemini is silently ignored | **6** (all bypass funnel, OpenAI-only) |
| Frontend files with hard-coded model lists | **2** (`AiSettingsPage.tsx`, `DialogueCourseSettingsForm.tsx`) |

---

## A. The funnel — `LlmService` and its direct fetch sites

`apps/api/src/rag/llm.service.ts`

| Line | Method | Calls out to | Funnel-routed? | Notes / Provider assumptions |
|---|---|---|---|---|
| 88 | `saveApiKey` | — | n/a | **Hard-coded default model**: `gemini-2.0-flash` (RETIRED) / `gpt-4o-mini` (legacy). Writes whichever is supplied — but if teacher omits a model this is what lands in DB. |
| 137 | `getUserApiKey` | — | n/a | Same hard-coded `gemini-2.0-flash` / `gpt-4o-mini` fallback when `User.llmModel` is null. |
| 430 | `callLlmForUser` | → `callLlm` → `callOpenAiApi` or `callGeminiApi` | THE FUNNEL | Public entry point. Accepts `{ jsonMode, maxTokens }` only. **No** per-model capability awareness today. |
| 498 | `uploadFileToOpenAi` | `POST https://api.openai.com/v1/files` | n/a (helper) | **OpenAI-only**. If provider is gemini, returns null without raising — caller falls back to inline base64. |
| 536 | `deleteFileFromOpenAi` | `DELETE https://api.openai.com/v1/files/:id` | n/a (helper) | OpenAI-only. |
| 640 | `callOpenAiApi` | `POST https://api.openai.com/v1/chat/completions` | inside funnel | Provider-assuming body: hard-codes `max_tokens` (line 631), `messages: [{ role: 'system' }, ...]` (633-634), `response_format: { type: 'json_object' }` (638). Reads `usage.prompt_tokens`/`completion_tokens` (660-662). **No temperature passed today.** **Will break on GPT-5.x reasoning models that require `max_completion_tokens` and reject `temperature` if anyone adds it.** |
| 680 | `callGeminiApi` | `POST https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent` | inside funnel | Uses `systemInstruction` (correct), `generationConfig.maxOutputTokens`, `generationConfig.responseMimeType` for JSON. **Hard-codes `v1beta` endpoint.** **No thinking config wired** — `thinking_budget` / `thinking_level` is missing entirely, so calls fall back to model default (fine for 2.x but Gemini 3.x typically requires `thinking_level` for non-thinking modes). Reads `usageMetadata.promptTokenCount`/`candidatesTokenCount`. |
| 723 | `generateWithoutApi` | — (template) | n/a | The "no API key" fallback path. Produces `model: 'template'` audit rows. |

---

## B. Callers of `callLlmForUser` (the 20 funnel-routed sites)

All of these are correctly going through the funnel. The provider/model swap will Just Work for them in Stage 3 once the funnel itself is registry-aware. Provider-specific assumptions are only in the JSON-mode and max-tokens options they pass.

| File | Line | Feature | jsonMode | maxTokens | Notes |
|---|---|---|---|---|---|
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 408 | `prompt_preview` | (none) | (none) | Teacher previews their own custom prompt. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 695 | `practice_testing` (generate) | (none) | (none) | Parses JSON via regex — no `jsonMode`! Brittle. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 933 | `interrogative_elaboration` (generate suggestions) | (none) | (none) | Parses JSON — no `jsonMode`. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 1033 | `interrogative_elaboration` (ask) | (none) | (none) | Free-text reply. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 1097 | `interrogative_elaboration` (summary) | (none) | (none) | Parses JSON — no `jsonMode`. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 1198 | `stepwise_learning` (generate) | (none) | (none) | Parses JSON — no `jsonMode`. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 1316 | `stepwise_learning` (check step) | (none) | (none) | Parses JSON — no `jsonMode`. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 1539 | `distributed_practice` (cards) | (none) | (none) | Parses JSON — no `jsonMode`. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 2028 | `practice_testing` (grade short answer) | (none) | (none) | Parses JSON — no `jsonMode`. |
| `apps/api/src/learning-interventions/learning-interventions.service.ts` | 2356 | `chatbot` | (none) | (none) | Floating/docked chatbot. Persists tokens + model into `chatbot_messages`. |
| `apps/api/src/dialogue/dialogue.service.ts` | 196 | `dialogue_chat` | (none) | (none) | Dialogue-mode chat. Persists tokens into `dialogue_messages.tokenUsage`. |
| `apps/api/src/dialogue/dialogue.service.ts` | 439 | `dialogue_title` | (none) | (none) | Auto-generates session title after 1st exchange. |
| `apps/api/src/dialogue/studio.service.ts` | 116 | `studio_*` | true | 8192 | Studio JSON tools (brief, flashcards, comparison). |
| `apps/api/src/dialogue/guide-generation.poller.ts` | 91 | `source_guide_generation` | (none) | (none) | Parses JSON — no `jsonMode`. Used by the EE2 event-driven poller. |
| `apps/api/src/student-rag/student-source-guide.service.ts` | 101 | `source_guide_generation` | true | (none) | Direct (non-poller) path for the same guide. |
| `apps/api/src/student-rag/file-parser.service.ts` | 230 | `image_ocr` | (none) | (none) | Image OCR via teacher LLM. **Sends base64 in the user prompt text**, not as a vision part — so this works on any provider, but it's wildly suboptimal and bypasses Gemini's native vision. |
| `apps/api/src/question-generation/question-generation.service.ts` | 236 | `question_generation` | (none) | (none) | Teacher assessment question gen. Parses JSON — no `jsonMode`. |
| `apps/api/src/question-generation/question-generation.service.ts` | 427 | `question_generation` (add-more) | (none) | (none) | Same. |
| `apps/api/src/question-generation/question-generation.service.ts` | 495 | `open_ended_grading` | (none) | (none) | Parses JSON — no `jsonMode`. |
| `apps/api/src/text-mining/detection/detection.service.ts` | 160 | `text_mining_detection` | true | 200 | Each EF construct = one call. Per-construct concurrency. Persists `{ provider, model }` from `getUserLlmSettings`. |
| `apps/api/src/text-mining/prompts/prompts.service.ts` | 138 | `text_mining_dry_run` | true | 200 | Dry-run for teacher when authoring a custom EF prompt. |

**Common funnel-routed problem:** `jsonMode: true` is only set on 5/20 sites despite 12+ of these parsing JSON from the reply. They rely on prose-with-fences and a hand-rolled `parseLlmJson` to strip code fences. Stage 3 should set `jsonMode: true` consistently and lean on provider-side structured output.

---

## C. Sites that BYPASS the funnel (7 bypasses)

Every one of these constructs its own credential decryption, model resolution, and provider HTTP call. **All seven are OpenAI-only** — they read `User.llmProvider` from the DB but never branch on it, so a teacher who set `provider = 'gemini'` would still hit OpenAI here (with their Gemini key) and either 401 or be billed on the wrong key.

| File | Line | Feature | What it does wrong |
|---|---|---|---|
| `apps/api/src/page-content/page-content.service.ts` | 243 → 566 | Multimodal PDF page-content generation | Own `getLlmCredentials` (line 460) defaulting to `gpt-4o-mini`; own `callOpenAiApi` that hard-codes `max_tokens: 8192`, `temperature: 0.3`, `response_format: { type: 'json_object' }`, and a multimodal `messages` array including `{ type: 'file', file: { file_id } }` or inline base64 (OpenAI vision-Files schema, **not** Gemini). No provider switch. Reads `usage.prompt_tokens` style. |
| `apps/api/src/evaluation/evaluation.service.ts` | 474 → 576 | Per-page LLM evaluation (`evaluateSinglePage`) | Own `getLlmCredentials` (546) defaulting to `gpt-4o-mini`; own `callOpenAiApi` hard-coding `max_tokens: 4096`, `temperature: 0.2`, `response_format: { type: 'json_object' }`. No provider switch. |
| `apps/api/src/kc/kc-graph.service.ts` | 569 (`callOpenAiApi`) | KC graph extraction | Own `callOpenAiApi` with `max_tokens: 4096`, `temperature: 0.3`, `response_format: json_object`. No provider switch. |
| `apps/api/src/kc/kc-suggestion.service.ts` | 201 (`callOpenAiApi`) | KC suggestion at draft time | Own decrypt + `callOpenAiApi` defaulting to `gpt-4o-mini`. |
| `apps/api/src/course-structure/course-structure.service.ts` | 513 (`callOpenAiApi`) | AI course outline generator | Own `getLlmCredentials` (477) defaulting to `gpt-4o-mini`; own `callOpenAiApi` with `max_tokens: 8192`, `temperature: 0.3`, `response_format: json_object`. |
| `apps/api/src/curriculum-coverage/curriculum-coverage.service.ts` | 840 (`callOpenAiApi`) | Curriculum coverage / gap analysis | Own decrypt + `callOpenAiApi` with `max_tokens: 4096`, `temperature: 0.3`, `response_format: json_object`. |
| `apps/api/src/text-mining/detection/llm-client.ts` | 37 / 61 (`detectJson`) | Helper module (currently NOT imported by anything live — `detection.service.ts` uses the funnel instead) | Lives as dead-but-shippable code. Constructs both provider branches manually; uses `temperature: 0`, `max_tokens: 200` on OpenAI and `maxOutputTokens: 200`, `responseMimeType: 'application/json'`, `temperature: 0` on Gemini. **Worth deleting or routing through the funnel in Stage 3.** |

### Per-bypass provider assumptions to fix in Stage 3

Each of the six live bypasses assumes:
- **System-prompt placement:** `messages: [{ role: 'system' }, { role: 'user' }]` — OpenAI shape. Gemini wants top-level `systemInstruction`.
- **Max-tokens param:** `max_tokens` — will be rejected by GPT-5.x reasoning models (which want `max_completion_tokens`) and is misnamed for Gemini (`generationConfig.maxOutputTokens`).
- **Temperature:** all set it to a constant 0.2-0.3 except `kc-graph` / `kc-suggestion` (0.3). GPT-5.x reasoning rejects custom temperature.
- **JSON mode:** `response_format: { type: 'json_object' }` — OpenAI-only. Gemini wants `generationConfig.responseMimeType: 'application/json'`.
- **Token-usage normalization:** all read `usage.prompt_tokens`/`completion_tokens` — wrong field names for Gemini (`usageMetadata.promptTokenCount`/`candidatesTokenCount`).
- **Model defaulting:** all fall back to `gpt-4o-mini` if `User.llmModel` is null, regardless of provider — so a Gemini teacher with no explicit model picks up a literal `"gpt-4o-mini"` string in cost-tracking rows.

These six bypasses are the highest-priority refactor targets in Stage 3.

---

## D. Embedding call sites

All embeddings live in **one** service. Teacher RAG (`apps/api/src/rag/rag.service.ts`) does NOT compute embeddings — its retrieval is keyword-only (`queryChunks` does ILIKE-style matches). Confirmed by grepping the file: the only mention of "embedding" is a comment at line 391 saying production should add them.

`apps/api/src/student-rag/embedding.service.ts`

| Line | Method | Calls out to | Notes |
|---|---|---|---|
| 4 | `EMBEDDING_DIMENSION = 1536` | n/a | **Hard-coded dimension.** Pinned to OpenAI ada-002 / text-embedding-3-small's 1536. The Gemini path overrides Gemini's native dimension to 1536 via `outputDimensionality` — see line 90. |
| 14-19 | `embed` switch | provider-aware | OK: branches `openai` vs `gemini`, deterministic SHA256 fallback otherwise. |
| 41 | `embedOpenAI` | `POST https://api.openai.com/v1/embeddings` | **Hard-coded model `text-embedding-ada-002` (line 48).** Ignores any teacher preference. Batches 100/req. |
| 85 | `embedGemini` | `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents` | **Hard-coded model `gemini-embedding-001` (URL line 85 and `model: 'models/gemini-embedding-001'` inside each request line 88).** Forces `outputDimensionality: 1536` to match OpenAI storage (line 90). |
| 127 | `generateFallbackEmbedding` | SHA256 hashing | Emits 1536-dim unit vectors. Storage-compatible — but semantically meaningless. |

### Consumers of `EmbeddingService.embed*`

- `apps/api/src/student-rag/student-rag.service.ts:205` — `processDocument` writes the resulting `embedding` JSONB into `student_rag_chunks.embedding`. Provider/key come from `getTeacherCredentials` (line 196), which decrypts the user's key and uses `user.llmProvider || dblSettings.llmProvider || 'fallback'`.
- `apps/api/src/student-rag/student-rag-retrieval.service.ts:190` — `denseRetrieval` calls `embedOne(query, apiKey, provider)` to embed the student's query, then cosine-similarity scores against stored chunk vectors.

### Embedding-specific risks (these all map to Stage 3 work)

1. The OpenAI embedding model is **hard-coded to the legacy `text-embedding-ada-002`** — not user-selectable today. Switching it requires re-embedding every chunk in `student_rag_chunks`.
2. The Gemini embedding model is **hard-coded to `gemini-embedding-001`**, also not user-selectable.
3. The `EMBEDDING_DIMENSION` constant (1536) is baked into both the fallback emitter and the Gemini `outputDimensionality` override. Any switch to `text-embedding-3-large` (3072) or a Gemini variant with a different native dim requires either Matryoshka-truncation or storage migration; **mixing dimensions across one corpus silently breaks cosine retrieval**.
4. There's no `embeddingModel` / `embeddingDimensions` column on `student_source_documents` or `student_rag_chunks`. A teacher who flips embedding provider mid-course will get polluted vectors with no defence.

---

## E. Multimodal / Files API path

Hot path:

1. **Ingest** — `apps/api/src/rag/rag.service.ts:248-262` calls `LlmService.uploadFileToOpenAi(uploadedById, filename, body, mimeType)` after extracting text. On success persists `source_documents.openaiFileId` + `openaiFileUploadedAt`. **Skipped silently when teacher's provider is gemini** (see funnel C below).
2. **Consume** — `apps/api/src/page-content/page-content.service.ts:496-563` (`fetchPdfAttachments`) prefers `openaiFileId` (`kind: 'file_id'`) and falls back to inline base64 when no id is set. Hands them to `callOpenAiApi` (line 566) as `messages[*].content[*] = { type: 'file', file: { file_id } | { filename, file_data } }`.
3. **Delete** — `apps/api/src/rag/rag.service.ts:166-168` fire-and-forget `LlmService.deleteFileFromOpenAi(uploadedById, openaiFileId)` when the local source is removed.
4. **Interventions PDF context** — `apps/api/src/learning-interventions/learning-interventions.service.ts:533-572` (`tryResolveFromModuleItem`) does NOT use the file_id; it extracts the already-chunked text from `document_chunks` and inlines it into the prompt. Provider-neutral.
5. **Chatbot PDF context** — `apps/api/src/learning-interventions/learning-interventions.service.ts:2251-2261` (in `chat()`) calls `tryResolveFromModuleItem` similarly. Provider-neutral.

**Multimodal flagged risks:**
- `openaiFileId` is meaningless under Gemini credentials. Right now the upload is skipped and the consumer (page-content) ships inline base64 — but that whole consumer is also OpenAI-only (bypass case D above), so a Gemini teacher cannot generate page content at all today.
- No `geminiFileId` / Gemini File API path exists.

---

## F. Frontend — model lists and provider pickers

| File | Lines | What it hard-codes |
|---|---|---|
| `apps/web/src/pages/teacher/AiSettingsPage.tsx` | 11-23 | `PROVIDER_MODELS` — full hard-coded list. OpenAI: `gpt-4o-mini`, `gpt-4o`, `gpt-4-turbo`, `gpt-3.5-turbo`. Gemini: `gemini-2.0-flash`, `gemini-2.0-flash-lite`, `gemini-2.5-flash-preview-05-20`, `gemini-2.5-pro-preview-05-06`. **None of the new Stage 1 reference models are listed.** |
| `apps/web/src/pages/teacher/AiSettingsPage.tsx` | 39-42 | `DEFAULT_MODELS` — `openai: 'gpt-4o-mini'`, `gemini: 'gemini-2.0-flash'`. **`gemini-2.0-flash` is the dead default.** |
| `apps/web/src/pages/teacher/AiSettingsPage.tsx` | 52, 135, 156, 180-181 | Hard-coded `gpt-4o-mini` literal and Gemini 2.0 marketing copy in UI strings. |
| `apps/web/src/components/teacher/DialogueCourseSettingsForm.tsx` | 24, 46-55 | A SECOND hard-coded model list for the per-course dialogue settings. Includes `gemini-2.5-flash-preview` (different value than AiSettings!), `gemini-2.5-pro-preview`, etc. Default `gpt-4o-mini`. |

Both of these need to be replaced in Stage 2 with a call to the registry built in this stage.

---

## G. Hard-coded model strings — full inventory

The string-to-fix list in `apps/api/src`:

| File | Line | String |
|---|---|---|
| `rag/llm.service.ts` | 88 | `'gemini-2.0-flash'` / `'gpt-4o-mini'` (default-model picker in `saveApiKey`) |
| `rag/llm.service.ts` | 137 | `'gemini-2.0-flash'` / `'gpt-4o-mini'` (default-model picker in `getUserApiKey`) |
| `student-rag/embedding.service.ts` | 48 | `'text-embedding-ada-002'` (OpenAI embed model) |
| `student-rag/embedding.service.ts` | 85, 88 | `'gemini-embedding-001'` (Gemini embed model — appears in URL and request payload) |
| `student-rag/embedding.service.ts` | 4 | `EMBEDDING_DIMENSION = 1536` (numeric, but acts as a model constant) |
| `page-content/page-content.service.ts` | 468 | `'gpt-4o-mini'` |
| `evaluation/evaluation.service.ts` | 556 | `'gpt-4o-mini'` |
| `kc/kc-graph.service.ts` | 543 | `'gpt-4o-mini'` |
| `kc/kc-suggestion.service.ts` | 175 | `'gpt-4o-mini'` |
| `course-structure/course-structure.service.ts` | 487 | `'gpt-4o-mini'` |
| `curriculum-coverage/curriculum-coverage.service.ts` | 814 | `'gpt-4o-mini'` |
| `text-mining/detection/detection.service.ts` | 107 | `'gpt-4o-mini'` |
| `user-management/llm-cost-calculator.ts` | n/a | (no hard-codes — reads `llm_model_pricing` table) |

In `apps/web/src`:

| File | Lines | Strings |
|---|---|---|
| `pages/teacher/AiSettingsPage.tsx` | 11-23, 39-42, 52, 135, 156 | All listed OpenAI + Gemini models above, plus the `gpt-4o-mini`/`gemini-2.0-flash` defaults |
| `components/teacher/DialogueCourseSettingsForm.tsx` | 24, 46-55 | Same set with slightly different Gemini IDs |

---

## H. Provider-specific assumptions to flag for Stage 3

Every item below is something the funnel or a bypass site currently assumes. Stage 3 needs registry capability flags to drive each one:

1. **`max_tokens` vs `max_completion_tokens`.** Funnel (`llm.service.ts:631`) and all six live bypasses use `max_tokens`. GPT-5.x reasoning models reject this and demand `max_completion_tokens`. Gemini uses neither — it wants `generationConfig.maxOutputTokens`.
2. **`temperature`.** Funnel doesn't set it. Bypasses set it (0.2 or 0.3). GPT-5.x reasoning models commonly reject any non-default temperature.
3. **`thinking_budget` (integer) vs `thinking_level` (string enum).** Funnel doesn't set either today. Gemini 3.x flips from `thinking_budget` (2.x) to `thinking_level: 'none' | 'low' | 'medium' | 'high'`. Once we add support, the param choice MUST be model-driven.
4. **`response_format: { type: 'json_object' }` vs `generationConfig.responseMimeType: 'application/json'`.** Funnel handles both (lines 638 and 686). Bypasses use only the OpenAI form.
5. **System prompt placement.** OpenAI: `messages: [{ role: 'system', content }, ...]`. Gemini: top-level `systemInstruction`. Funnel does this correctly per provider; bypasses do the OpenAI form only.
6. **Token-usage field names.** OpenAI: `usage.prompt_tokens`, `usage.completion_tokens`. Gemini: `usageMetadata.promptTokenCount`, `usageMetadata.candidatesTokenCount`. Funnel handles both; bypasses handle OpenAI only (so Gemini bypass usage rows would be `null`/0 → silent cost-tracking dropout).
7. **`openaiFileId`** is meaningless under Gemini. There's no `geminiFileId` column or upload helper. Page-content + the (currently unused) `text-mining/detection/llm-client.ts` are the two paths that need a parallel Gemini Files API uploader or a chunked-text fallback.
8. **`v1beta` endpoint.** `llm.service.ts:680` and `embedding.service.ts:85` and `text-mining/detection/llm-client.ts:61` all hard-code `v1beta`. Gemini 3.x lives at `v1beta` too as of writing but this is a sharp edge worth abstracting through the registry.

---

## I. SDK-construction check

Searched for `new OpenAI(`, `GoogleGenAI`, `GoogleGenerativeAI`, `@google/generative-ai`, `openai-node`. **No matches.** Every provider call goes through raw `fetch`. Good — no SDK lock-in to undo.

---

## J. Recap of files relevant to Stages 2-4

**Touched by Stage 2 (UI + model lists wired to registry):**
- `apps/web/src/pages/teacher/AiSettingsPage.tsx`
- `apps/web/src/components/teacher/DialogueCourseSettingsForm.tsx`
- API endpoint to surface the registry (probably under `LlmService` controller surface — to be designed in Stage 2).

**Touched by Stage 3 (provider/model compatibility through registry):**
- `apps/api/src/rag/llm.service.ts` (the funnel itself)
- `apps/api/src/student-rag/embedding.service.ts` (the only embedding service)
- Every bypass site listed in section C
- All callers of `callLlmForUser` (mostly inherit fix from funnel; `jsonMode` toggles set where missing)
- `apps/api/src/text-mining/detection/llm-client.ts` (delete or route through funnel)

**Touched by Stage 4 (verification matrix):**
- Every call site in this audit, exercised under both `openai` and `gemini` teacher provider settings with every listed model.

---

## K. Assumptions made for the Stage 1 registry seed

The audit drives the following seed-data decisions that go into `model-registry.ts`:

- **Embedding dimensions.** The codebase pins everything to 1536 via `EMBEDDING_DIMENSION` and overrides Gemini's `outputDimensionality` to 1536 too (`embedding.service.ts:90`). The reference doc says `gemini-embedding-001` is "currently in use" without naming a native dim. The Gemini docs list 768 as the native default for `gemini-embedding-001` (truncatable to 1536/3072 on supported tiers). I am seeding `gemini-embedding-001` at **768** as its native dimension (matches Google docs) and adding `truncatableTo: [768, 1536, 3072]` so the existing 1536-dim usage stays selectable through truncation. Existing chunks remain compatible because the registry is not yet consumed at runtime — Stage 3 will pin per-corpus and force re-embed if changed.
- **`gemini-embedding-2`.** Stage 1 prompt says skip if availability unverifiable. I am **omitting** it from the seed; Stage 2 or 3 can add it once availability under the teacher's API tier is confirmed.
- **GPT-5.x capability flags.** Per the risk register: `supportsTemperature: false`, `maxTokensParam: 'max_completion_tokens'`, `supportsJsonMode: true`, `supportsOpenAiFilesApi: true`.
- **GPT-4.1 / GPT-4o family.** `supportsTemperature: true`, `maxTokensParam: 'max_tokens'`, `supportsJsonMode: true`, `supportsOpenAiFilesApi: true`.
- **Gemini 3.x.** `geminiThinkingParam: 'thinking_level'`, `supportsJsonMode: true`, `supportsOpenAiFilesApi: false`.
- **Gemini 2.x.** `geminiThinkingParam: 'thinking_budget'`, `supportsJsonMode: true`, `supportsOpenAiFilesApi: false`. `gemini-2.0-flash` marked `deprecated: true` with `retiresOn: '2026-06-01'` (yesterday).
