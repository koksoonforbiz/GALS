/**
 * Single source of truth for every chat + embedding model the platform
 * supports, and the call-shape flags the funnel needs to talk to each.
 *
 * **This is data, not constants scattered through the code.** Every place
 * that previously hard-coded `'gpt-4o-mini'`, `'gemini-2.0-flash'`,
 * `'text-embedding-ada-002'`, etc. should be migrated to read from here
 * (Stage 3). The teacher-facing model list (Stage 2) is also driven by
 * this file.
 *
 * Stage 1 deliverable — no existing call site consumes the registry yet.
 *
 * Seeded from `LLM_20260602/00_overview_and_model_reference.md`. When the
 * provider docs move, edit this file (and bump the relevant capability
 * flags); nothing else should need to change.
 */

// ─── Types ──────────────────────────────────────────────────

export type LlmProvider = 'openai' | 'gemini' | 'cohere' | 'bedrock';
export type ModelCapability = 'chat' | 'embedding' | 'vision';

export interface ChatModelSpec {
  /** Exact provider model string, e.g. `'gpt-5.4-mini'`. This is what gets
   *  sent to the provider's API and what is stored in `User.llmModel`. */
  id: string;
  provider: LlmProvider;
  /** Shown in the teacher dropdown. */
  label: string;
  capabilities: ModelCapability[];

  // ── Call-shape flags (consumed by the funnel in Stage 3) ──

  /** GPT-5.x reasoning models reject a custom temperature. */
  supportsTemperature: boolean;
  /** GPT-5.x uses `max_completion_tokens`; older OpenAI + Gemini use
   *  `max_tokens` / `maxOutputTokens`. We normalize to OpenAI naming here
   *  because Gemini uses its own param name regardless. */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  supportsJsonMode: boolean;
  /** Gemini 3.x uses string enum `thinking_level`; 2.x used integer
   *  `thinking_budget`. Not applicable to OpenAI (`'none'` for OpenAI). */
  geminiThinkingParam?: 'thinking_level' | 'thinking_budget' | 'none';
  /** True if the model can consume a previously-uploaded OpenAI Files API
   *  `file_id` for multimodal inputs (PDF, images). Gemini models are
   *  always false here — Gemini has its own file API. */
  supportsOpenAiFilesApi?: boolean;
  deprecated?: boolean;
  /** ISO date. Past dates mean the model is fully retired and must not be
   *  selectable. Future dates serve as a UI warning. */
  retiresOn?: string;
}

export interface EmbeddingModelSpec {
  id: string;
  provider: LlmProvider;
  label: string;
  /** Native vector dimension. The corpus storage MUST match this (or a
   *  value from `truncatableTo`). */
  dimensions: number;
  /** Matryoshka-style options where the provider supports requesting a
   *  truncated embedding (OpenAI `text-embedding-3-large` and Gemini
   *  `gemini-embedding-001` both support this via an output-dimension
   *  param). */
  truncatableTo?: number[];
  /** Stage 05 — true when this spec can embed an IMAGE (or
   *  interleaved text+image) into the SAME vector space as text.
   *  Today only Cohere Embed 4 qualifies; OpenAI's text-embedding
   *  family is text-only, and Gemini embedding-001 likewise. The
   *  multimodal ingest path routes image inputs through specs flagged
   *  here; falls back to the text-only default for `text` chunks. */
  supportsImageEmbedding?: boolean;
  deprecated?: boolean;
}

// ─── Seed data ──────────────────────────────────────────────

const CHAT_MODELS: ChatModelSpec[] = [
  // ── OpenAI ──
  {
    id: 'gpt-5.5',
    provider: 'openai',
    label: 'GPT-5.5 (flagship reasoning)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: false,
    maxTokensParam: 'max_completion_tokens',
    supportsJsonMode: true,
    supportsOpenAiFilesApi: true,
  },
  {
    id: 'gpt-5.4-mini',
    provider: 'openai',
    label: 'GPT-5.4 Mini (recommended)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: false,
    maxTokensParam: 'max_completion_tokens',
    supportsJsonMode: true,
    supportsOpenAiFilesApi: true,
  },
  {
    id: 'gpt-5.4-nano',
    provider: 'openai',
    label: 'GPT-5.4 Nano (cheapest / fastest)',
    capabilities: ['chat'],
    supportsTemperature: false,
    maxTokensParam: 'max_completion_tokens',
    supportsJsonMode: true,
    supportsOpenAiFilesApi: true,
  },
  {
    id: 'gpt-4.1',
    provider: 'openai',
    label: 'GPT-4.1 (non-reasoning, tool-calling)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    supportsOpenAiFilesApi: true,
  },
  {
    id: 'gpt-4o',
    provider: 'openai',
    label: 'GPT-4o (legacy)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    supportsOpenAiFilesApi: true,
    deprecated: true,
  },
  {
    id: 'gpt-4o-mini',
    provider: 'openai',
    label: 'GPT-4o Mini (legacy)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    supportsOpenAiFilesApi: true,
    deprecated: true,
  },

  // ── Gemini ──
  {
    id: 'gemini-3.5-flash',
    provider: 'gemini',
    label: 'Gemini 3.5 Flash (recommended)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    geminiThinkingParam: 'thinking_level',
    supportsOpenAiFilesApi: false,
  },
  {
    id: 'gemini-3.1-pro',
    provider: 'gemini',
    label: 'Gemini 3.1 Pro (strongest reasoning)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    geminiThinkingParam: 'thinking_level',
    supportsOpenAiFilesApi: false,
  },
  {
    id: 'gemini-3.1-flash-lite',
    provider: 'gemini',
    label: 'Gemini 3.1 Flash Lite (cheapest)',
    capabilities: ['chat'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    geminiThinkingParam: 'thinking_level',
    supportsOpenAiFilesApi: false,
  },
  {
    id: 'gemini-2.5-flash',
    provider: 'gemini',
    label: 'Gemini 2.5 Flash (legacy)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    geminiThinkingParam: 'thinking_budget',
    supportsOpenAiFilesApi: false,
    deprecated: true,
  },
  {
    id: 'gemini-2.0-flash',
    provider: 'gemini',
    label: 'Gemini 2.0 Flash (retired)',
    capabilities: ['chat'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    geminiThinkingParam: 'thinking_budget',
    supportsOpenAiFilesApi: false,
    deprecated: true,
    // Past date — the model is no longer reachable. Stage 2 migrates any
    // teacher still pointed at it to the new Gemini default.
    retiresOn: '2026-06-01',
  },

  // ── Bedrock (OpenAI models hosted on AWS Bedrock) ──
  //
  // Single shared server-side credential (AWS_BEARER_TOKEN + AWS_REGION,
  // see callBedrockApi in llm.service.ts) rather than a per-teacher key —
  // any teacher who selects this provider uses the same AWS account.
  // Called via Bedrock's model-agnostic Converse API, routed through the
  // AWS_REGION regional endpoint (defaults to ap-southeast-1). `id` here
  // is the Bedrock INFERENCE PROFILE id, not the bare foundation-model
  // id — these models reject on-demand invocation by the plain model id
  // ("...isn't supported. Retry your request with the ID or ARN of an
  // inference profile that contains this model."), and IT confirmed
  // `global.<model>` is the profile id to use. Verified 2026-09-02
  // against the real endpoint via scripts/scratch-test-bedrock.mjs —
  // both return 200 with the expected Converse response shape.
  {
    id: 'global.openai.gpt-5.6-terra',
    provider: 'bedrock',
    label: 'GPT-5.6 Terra (AWS Bedrock)',
    // GPT-5.x-class models are vision-capable elsewhere in this
    // registry — assumed true here too (untested against the real
    // Bedrock endpoint; see callBedrockApi's image content-block
    // translation). Flag this as unverified if VLM testing shows
    // otherwise.
    capabilities: ['chat', 'vision'],
    supportsTemperature: true,
    // Unused by the Bedrock call path (Converse API has its own
    // `inferenceConfig.maxTokens` shape) — set only to satisfy this
    // shared interface.
    maxTokensParam: 'max_tokens',
    // No schema-bound response_format on Bedrock Converse for this
    // model family; JSON mode is enforced by prompt instruction only
    // (see callBedrockApi).
    supportsJsonMode: true,
    supportsOpenAiFilesApi: false,
  },
  {
    id: 'global.openai.gpt-5.6-sol',
    provider: 'bedrock',
    label: 'GPT-5.6 Sol (AWS Bedrock)',
    capabilities: ['chat', 'vision'],
    supportsTemperature: true,
    maxTokensParam: 'max_tokens',
    supportsJsonMode: true,
    supportsOpenAiFilesApi: false,
  },
];

const EMBEDDING_MODELS: EmbeddingModelSpec[] = [
  // ── OpenAI ──
  {
    id: 'text-embedding-3-small',
    provider: 'openai',
    label: 'OpenAI text-embedding-3-small (recommended)',
    dimensions: 1536,
  },
  {
    id: 'text-embedding-3-large',
    provider: 'openai',
    label: 'OpenAI text-embedding-3-large (highest quality)',
    dimensions: 3072,
    truncatableTo: [256, 512, 1024, 1536],
  },
  {
    id: 'text-embedding-ada-002',
    provider: 'openai',
    label: 'OpenAI text-embedding-ada-002 (legacy)',
    dimensions: 1536,
    deprecated: true,
  },

  // ── Gemini ──
  //
  // Native dim for `gemini-embedding-001` per Google's docs is 768; the
  // service supports requesting a larger truncated output (up to 3072).
  // The current `apps/api/src/student-rag/embedding.service.ts` pins
  // `outputDimensionality: 1536` to stay storage-compatible with OpenAI
  // ada-002 — that path will keep working via the `truncatableTo` list.
  // `gemini-embedding-2` deliberately omitted (Stage 1 prompt: skip if
  // availability unverifiable).
  {
    id: 'gemini-embedding-001',
    provider: 'gemini',
    label: 'Gemini embedding-001 (recommended)',
    dimensions: 768,
    truncatableTo: [768, 1536, 3072],
  },

  // ── Cohere (Stage 05 multimodal) ──
  //
  // Cohere Embed 4 (`embed-v4.0`) is the FIRST embedding model in the
  // registry that returns vectors for both TEXT and IMAGES in the
  // SAME vector space. That lets us keep the single-vector-per-chunk
  // substrate (in-memory JSONB cosine) while making charts/tables/
  // figures first-class retrieval objects — see
  // `prompts_rag/05_multimodal_pdf_ingest.md` and the AUDIT.
  //
  // Native dim is 1536 via Matryoshka `output_dimension` so it's a
  // drop-in match for `text-embedding-3-small` (the platform-wide
  // text default). Other supported Matryoshka outputs (256/512/1024)
  // are listed in `truncatableTo` for future operators that want to
  // pin a different corpus dim; cosine still works as long as ALL
  // chunks in the corpus share it (Stage 02 retrieval guard).
  //
  // Routing: when `RAG_MULTIMODAL_PDF=true` (or the per-course
  // override) AND a Cohere key is present on the teacher's User row
  // (reused from `User.cohereApiKey` — same vendor as the Stage 04
  // reranker), the multimodal funnel uses this spec for `page_image`
  // / `figure` chunks AND for `text` chunks to keep the corpus
  // single-vector-space. When NO Cohere key is configured, the
  // funnel falls back to OpenAI / Gemini text embeddings (image
  // chunks then simply aren't created).
  {
    id: 'embed-v4.0',
    provider: 'cohere',
    label: 'Cohere Embed 4 (multimodal text+image, recommended)',
    dimensions: 1536,
    truncatableTo: [256, 512, 1024, 1536],
    supportsImageEmbedding: true,
  },

  // ── Bedrock (Cohere Embed 4 hosted on AWS Bedrock) ──
  //
  // Same server-wide credential as the Bedrock chat models above — see
  // embedBedrockCohere in embedding.service.ts. This is the TEXT
  // embedding path only (course document search) — the separate
  // multimodal page-image embedding pipeline (callMultimodalEmbedding)
  // still goes through the direct Cohere API + a teacher's own
  // `cohereApiKey`, not this spec; wiring that one to Bedrock too is
  // unfinished. `id` is the Bedrock model ID (resource-name segment of
  // its foundation-model ARN), invoked via Bedrock's native
  // InvokeModel (Converse doesn't support embedding models).
  {
    id: 'cohere.embed-v4:0',
    provider: 'bedrock',
    label: 'Cohere Embed 4 (AWS Bedrock, text)',
    dimensions: 1536,
    // No truncatableTo: unlike the direct Cohere API, embedBedrockCohere
    // doesn't send `output_dimension` — unverified whether Bedrock's
    // InvokeModel body for this model even accepts it, so this always
    // requests/returns the native 1536-dim vector rather than silently
    // ignoring a truncation request the registry advertised.
  },
];

// ─── Defaults ───────────────────────────────────────────────

// Cohere intentionally absent — it's not a chat provider in this
// platform (we use it for embedding-4 and rerank-v3.5 only). When
// `defaultChatModel('cohere')` is ever called, it throws — that's
// the intended contract; callers asking for a Cohere chat default
// have made a category error.
const DEFAULT_CHAT_BY_PROVIDER: Partial<Record<LlmProvider, string>> = {
  openai: 'gpt-5.4-mini',
  gemini: 'gemini-3.5-flash',
  bedrock: 'global.openai.gpt-5.6-sol',
};

const DEFAULT_EMBEDDING_BY_PROVIDER: Partial<Record<LlmProvider, string>> = {
  openai: 'text-embedding-3-small',
  gemini: 'gemini-embedding-001',
  bedrock: 'cohere.embed-v4:0',
  // Stage 05 — Cohere Embed 4 (multimodal). Pinned to 1536 dims via
  // Matryoshka `output_dimension`. Used when `RAG_MULTIMODAL_PDF` is
  // on AND the teacher has a Cohere key configured; otherwise the
  // funnel routes to OpenAI/Gemini text embeddings and image chunks
  // aren't created.
  cohere: 'embed-v4.0',
};

// ─── Accessors ──────────────────────────────────────────────

export function getChatModel(id: string): ChatModelSpec | undefined {
  return CHAT_MODELS.find((m) => m.id === id);
}

export function getEmbeddingModel(id: string): EmbeddingModelSpec | undefined {
  return EMBEDDING_MODELS.find((m) => m.id === id);
}

export function listChatModels(provider?: LlmProvider): ChatModelSpec[] {
  return provider ? CHAT_MODELS.filter((m) => m.provider === provider) : [...CHAT_MODELS];
}

export function listEmbeddingModels(provider?: LlmProvider): EmbeddingModelSpec[] {
  return provider ? EMBEDDING_MODELS.filter((m) => m.provider === provider) : [...EMBEDDING_MODELS];
}

export function defaultChatModel(provider: LlmProvider): ChatModelSpec {
  const id = DEFAULT_CHAT_BY_PROVIDER[provider];
  if (!id) {
    throw new Error(
      `Provider "${provider}" has no default chat model registered (Cohere is embedding/rerank only)`,
    );
  }
  const spec = getChatModel(id);
  if (!spec) {
    throw new Error(
      `Registry default chat model "${id}" for provider "${provider}" is not in the registry`,
    );
  }
  return spec;
}

export function defaultEmbeddingModel(provider: LlmProvider): EmbeddingModelSpec {
  const id = DEFAULT_EMBEDDING_BY_PROVIDER[provider];
  if (!id) {
    throw new Error(
      `Provider "${provider}" has no default embedding model registered (chat-only provider).`,
    );
  }
  const spec = getEmbeddingModel(id);
  if (!spec) {
    throw new Error(
      `Registry default embedding model "${id}" for provider "${provider}" is not in the registry`,
    );
  }
  return spec;
}

/**
 * Stage 05 — resolve the preferred multimodal embedding spec. Returns
 * the first registry entry flagged `supportsImageEmbedding: true`, or
 * `undefined` when none is registered (caller should fall back to
 * text-only ingest in that case). Today this picks Cohere Embed 4.
 *
 * Callers also need a key for the provider; we surface the spec only
 * — key resolution is the embedding-service's job (it owns the
 * `User.cohereApiKey` decrypt path).
 */
export function defaultMultimodalEmbeddingModel(): EmbeddingModelSpec | undefined {
  return EMBEDDING_MODELS.find((m) => m.supportsImageEmbedding && !m.deprecated);
}

/**
 * Should this model appear in the teacher's dropdown / be saveable as a
 * new selection? False for deprecated models with a past `retiresOn`
 * (i.e. fully retired), true for everything else — including merely
 * `deprecated: true` legacy models, since teachers with existing
 * configurations should still be able to read/keep them. Stage 2 also
 * surfaces a warning banner for deprecated-but-still-selectable models.
 */
export function isSelectable(id: string): boolean {
  const spec = getChatModel(id) ?? getEmbeddingModel(id);
  if (!spec) return false;
  // EmbeddingModelSpec has no retiresOn; treat any deprecated embedding
  // as still selectable (caller must use Stage 2 UI to migrate). Only
  // chat models can be hard-retired.
  if ('retiresOn' in spec && typeof spec.retiresOn === 'string') {
    const retiresAt = Date.parse(spec.retiresOn);
    if (!Number.isNaN(retiresAt) && retiresAt <= Date.now()) {
      return false;
    }
  }
  return true;
}
