import { Injectable, Logger } from '@nestjs/common';
import * as crypto from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import {
  getEmbeddingModel,
  defaultEmbeddingModel,
  defaultMultimodalEmbeddingModel,
  type EmbeddingModelSpec,
  type LlmProvider,
} from '../llm/model-registry';

const OPENAI_BATCH_SIZE = 100;

// Stage 05 — Cohere v2 /embed accepts up to 96 inputs per request for
// text and ~16 for image batches (per Cohere docs as of 2026-Q2). We
// keep image batches small to stay well under the limit AND to bound
// memory pressure (each base64-encoded PNG can exceed 5 MB before
// upload). Text-only batches under the multimodal funnel reuse the
// same 96-cap. Stage 06+ can tune this per ingest path.
const COHERE_TEXT_BATCH_SIZE = 96;
const COHERE_IMAGE_BATCH_SIZE = 8;

const COHERE_EMBED_ENDPOINT = 'https://api.cohere.com/v2/embed';

/**
 * Stage 05 — Frontier-tier upgrade note.
 *
 * The funnel below stays SINGLE-VECTOR-PER-CHUNK so charts/tables flow
 * through the existing in-memory cosine + RRF + reranker hot path with
 * no changes downstream. ColPali / late-interaction multi-vector
 * retrieval (e.g. PLAID, pgvector HNSW with multi-vector + MaxSim)
 * would meaningfully outperform single-vector page embeddings on
 * dense figures — but it requires (a) a real vector DB with multi-
 * vector + MaxSim support, and (b) GPU infra for the ColPali weights.
 * Both are out of scope for milestone 1. The TODO is mirrored in
 * `pdf-rasterizer.service.ts` so the decision is documented.
 */

/**
 * Stage 02 (Task E) — Pseudo-vector fallback gate.
 *
 * The SHA256 deterministic-hash "embedding" fallback in
 * `generateFallbackEmbedding` exists so dev can keep ingesting +
 * retrieving without any LLM API key. It is NOT a real semantic
 * embedding — it only matches identical tokens. In production we MUST
 * refuse to silently downgrade retrieval to keyword-only via a
 * degenerate vector.
 *
 * Default: `true` in dev/test, `false` in prod. Operators can override
 * with `RAG_ALLOW_PSEUDO_EMBEDDINGS=true` if they explicitly want the
 * fallback in a hosted environment (e.g. a demo deployment).
 *
 * When this returns false and the funnel would otherwise return a
 * pseudo-vector, we THROW with a clear "RAG_PSEUDO_EMBEDDING_BLOCKED"
 * error so callers can `try/catch` and surface "configure an LLM key"
 * to the operator/student.
 */
export function pseudoEmbeddingsAllowed(): boolean {
  const raw = process.env.RAG_ALLOW_PSEUDO_EMBEDDINGS;
  if (raw !== undefined) {
    const v = raw.toLowerCase();
    return v === 'true' || v === '1' || v === 'on' || v === 'yes';
  }
  // Default policy: allow in dev/test, block in production.
  return (process.env.NODE_ENV ?? 'development') !== 'production';
}

/** Sentinel `embeddingModel` value for chunks generated via the SHA256
 *  fallback path. The retrieval guard surfaces these as
 *  `degradedRetrieval=true`. */
export const PSEUDO_EMBEDDING_MODEL = 'sha256-pseudo';

class PseudoEmbeddingBlockedError extends Error {
  constructor(reason: string) {
    super(
      `RAG_PSEUDO_EMBEDDING_BLOCKED: ${reason}. Configure a teacher LLM API key, or set RAG_ALLOW_PSEUDO_EMBEDDINGS=true to allow degraded retrieval (dev/demo only).`,
    );
    this.name = 'PseudoEmbeddingBlockedError';
  }
}

export interface EmbeddingFunnelResult {
  vectors: number[][];
  /** Provider model id actually used (e.g. `text-embedding-3-small`). */
  model: string;
  /** Dimensionality of each vector — what the corpus must pin. */
  dimensions: number;
  /** Provider that produced the vectors (`openai` | `gemini` | `fallback`). */
  provider: 'openai' | 'gemini' | 'fallback';
}

// ─── Stage 05 — Multimodal funnel types ────────────────────

/** Text input for the multimodal funnel. Embedded as text under the
 *  multimodal model (kept in the same vector space as image inputs). */
export interface MultimodalTextInput {
  kind: 'text';
  text: string;
}

/** Image input for the multimodal funnel. `bytes` is the raw PNG/JPEG
 *  buffer (typical: a 150-DPI page render). `mimeType` is the data-
 *  URL prefix — `image/png` for `pdf-img-convert` output. */
export interface MultimodalImageInput {
  kind: 'image';
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
}

export type MultimodalEmbeddingInput = MultimodalTextInput | MultimodalImageInput;

export interface MultimodalEmbeddingResult {
  /** One entry per input in input order. `null` means the input
   *  could not be embedded (no Cohere key for an image input, Cohere
   *  outage, decrypt failure). Caller should skip persisting that
   *  chunk. */
  vectors: (number[] | null)[];
  model: string;
  dimensions: number;
  provider: 'cohere' | 'openai' | 'gemini' | 'fallback';
}

interface TeacherEmbeddingCredentials {
  apiKey: string | null;
  provider: LlmProvider | 'fallback';
  spec: EmbeddingModelSpec;
  /** If the corpus pins a specific output dim (Matryoshka truncation),
   *  callers can pass it here to override the spec native dim. Must be in
   *  `spec.truncatableTo` if set. */
  outputDimensions?: number;
}

@Injectable()
export class EmbeddingService {
  private readonly logger = new Logger(EmbeddingService.name);

  constructor(private readonly prisma: PrismaService) {}

  // ─── Registry-driven embedding funnel (Stage 3) ─────────

  /**
   * Resolve the teacher's embedding model + decrypted key. Used by the
   * funnel and by callers that need to know the active model/dim BEFORE
   * embedding (e.g. retrieval guard).
   */
  async resolveTeacherEmbeddingSpec(
    teacherId: string,
    outputDimensions?: number,
  ): Promise<TeacherEmbeddingCredentials> {
    const user = await this.prisma.user.findUnique({
      where: { id: teacherId },
      select: { encryptedApiKey: true, llmProvider: true, llmEmbeddingModel: true },
    });

    const provider = (user?.llmProvider === 'gemini' ? 'gemini' : 'openai') as LlmProvider;
    const modelId = user?.llmEmbeddingModel;
    const spec = (modelId && getEmbeddingModel(modelId)) || defaultEmbeddingModel(provider);

    // If the spec belongs to a different provider than the teacher's set
    // provider (Stage 2 validation should prevent this on save, but be
    // defensive), fall back to the provider's default embedding model.
    const effectiveSpec = spec.provider === provider ? spec : defaultEmbeddingModel(provider);

    let apiKey: string | null = null;
    if (user?.encryptedApiKey) {
      try {
        apiKey = this.decryptApiKey(user.encryptedApiKey);
      } catch (err) {
        this.logger.error(
          `Failed to decrypt API key for teacher ${teacherId}: ${(err as Error).message}`,
        );
      }
    }

    return {
      apiKey,
      provider: apiKey ? provider : 'fallback',
      spec: effectiveSpec,
      outputDimensions,
    };
  }

  /**
   * Public entry point. Resolves teacher creds → registry spec → calls
   * the provider with capability-correct request shape → returns vectors
   * and the (model, dimensions) actually used so callers can pin the
   * corpus rows.
   */
  async callEmbeddingForUser(
    teacherId: string,
    texts: string[],
    options: { outputDimensions?: number } = {},
  ): Promise<EmbeddingFunnelResult> {
    if (texts.length === 0) {
      const fallbackSpec = defaultEmbeddingModel('openai');
      return {
        vectors: [],
        model: fallbackSpec.id,
        dimensions: fallbackSpec.dimensions,
        provider: 'fallback',
      };
    }

    const creds = await this.resolveTeacherEmbeddingSpec(teacherId, options.outputDimensions);

    // Decide actual dimension we'll request (Matryoshka truncation).
    const requestedDim = this.pickOutputDimension(creds.spec, options.outputDimensions);

    if (!creds.apiKey || creds.provider === 'fallback') {
      return this.makeFallbackResult(
        texts,
        creds.spec.id,
        requestedDim,
        'no API key configured for teacher',
      );
    }

    try {
      if (creds.provider === 'openai') {
        const vectors = await this.embedOpenAI(
          texts,
          creds.apiKey,
          creds.spec.id,
          requestedDim !== creds.spec.dimensions ? requestedDim : undefined,
        );
        return { vectors, model: creds.spec.id, dimensions: requestedDim, provider: 'openai' };
      }

      const vectors = await this.embedGemini(
        texts,
        creds.apiKey,
        creds.spec.id,
        requestedDim,
      );
      return { vectors, model: creds.spec.id, dimensions: requestedDim, provider: 'gemini' };
    } catch (err) {
      // Hard fail in funnel → fallback so a single bad batch doesn't kill
      // the document, but log it loudly.
      this.logger.error(
        `Embedding provider call failed (${creds.provider}/${creds.spec.id}): ${(err as Error).message}`,
      );
      return this.makeFallbackResult(
        texts,
        creds.spec.id,
        requestedDim,
        `provider call failed: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Embed a single text. Use the same funnel so we get the same
   * model/dimensions for retrieval guards.
   */
  async embedOneForUser(
    teacherId: string,
    text: string,
    options: { outputDimensions?: number } = {},
  ): Promise<EmbeddingFunnelResult & { vector: number[] }> {
    const result = await this.callEmbeddingForUser(teacherId, [text], options);
    return { ...result, vector: result.vectors[0]! };
  }

  // ─── Stage 05 — Multimodal funnel (Cohere Embed 4) ──────
  //
  // Image and text chunks must live in the SAME vector space so the
  // hybrid retriever's in-memory cosine loop can score them against
  // the same query embedding. We achieve that with Cohere Embed 4 —
  // request 1536 dims via Matryoshka `output_dimension` to match the
  // platform-wide text default (`text-embedding-3-small`). The same
  // model embeds text inputs too, so this is a true unified
  // single-vector substrate.
  //
  // When NO Cohere key is configured (most installs at flag-flip
  // time), the funnel transparently degrades:
  //   - text inputs → routed to the configured text embedder
  //     (`callEmbeddingForUser`).
  //   - image inputs → dropped with a WARN; ingest continues with
  //     text-only chunks (Stage 04 behaviour).
  // Triple-defensive: a single bad batch / Cohere outage / decrypt
  // failure NEVER aborts ingest — failed inputs are returned as zero
  // vectors with the `'sha256-pseudo'` sentinel so caller code can
  // detect them and skip persisting.

  /**
   * Multimodal embedding entry point. Accepts a heterogeneous mix of
   * text and image inputs and returns a vector for each, in input
   * order. The returned `(model, dimensions, provider)` tuple
   * reflects what was actually called — pin this on the chunk row.
   *
   * Image inputs MUST be PNG/JPEG bytes (typical: 150 DPI page
   * renders). The funnel base64-encodes them into a Cohere
   * `image_url` data URL before calling the API.
   *
   * @returns one entry per input. `vectors[i]` is null when the
   * corresponding image input could not be embedded (no Cohere key,
   * Cohere down) — caller should skip persisting that chunk.
   */
  async callMultimodalEmbedding(
    teacherId: string,
    inputs: MultimodalEmbeddingInput[],
  ): Promise<MultimodalEmbeddingResult> {
    if (inputs.length === 0) {
      const spec = defaultMultimodalEmbeddingModel() ?? defaultEmbeddingModel('openai');
      return {
        vectors: [],
        model: spec.id,
        dimensions: spec.dimensions,
        provider: spec.provider === 'cohere' ? 'cohere' : 'fallback',
      };
    }

    const spec = defaultMultimodalEmbeddingModel();
    const cohereKey = spec ? await this.resolveCohereKey(teacherId) : null;
    const hasImageInputs = inputs.some((i) => i.kind === 'image');

    // Path A — Multimodal funnel via Cohere Embed 4. Used when the
    // teacher has a Cohere key configured (the same key the Stage 04
    // reranker uses) AND the registry has a multimodal spec.
    if (spec && cohereKey) {
      const vectors: (number[] | null)[] = new Array(inputs.length).fill(null);
      // Process text and image batches separately because Cohere's
      // v2 /embed endpoint has different per-batch caps for each.
      // Within a batch the same `model` + `output_dimension` apply,
      // so vectors stay in the unified 1536-dim space.
      const dim = 1536;

      const textIndices: number[] = [];
      const imageIndices: number[] = [];
      for (let i = 0; i < inputs.length; i++) {
        if (inputs[i]!.kind === 'image') imageIndices.push(i);
        else textIndices.push(i);
      }

      // Text inputs through Cohere multimodal (keeps the corpus
      // single-vector-space).
      for (let off = 0; off < textIndices.length; off += COHERE_TEXT_BATCH_SIZE) {
        const slice = textIndices.slice(off, off + COHERE_TEXT_BATCH_SIZE);
        const texts = slice.map((idx) => (inputs[idx] as MultimodalTextInput).text);
        try {
          const out = await this.embedCohereText(
            texts,
            cohereKey,
            spec.id,
            dim,
            'search_document',
          );
          for (let j = 0; j < slice.length; j++) vectors[slice[j]!] = out[j]!;
        } catch (err) {
          this.logger.warn(
            `Cohere text embed batch ${off}-${off + slice.length} failed: ${(err as Error).message}`,
          );
          // Triple-defensive: leave null so caller skips persisting.
        }
      }

      // Image inputs — base64 PNG/JPEG data URLs through the same model.
      for (let off = 0; off < imageIndices.length; off += COHERE_IMAGE_BATCH_SIZE) {
        const slice = imageIndices.slice(off, off + COHERE_IMAGE_BATCH_SIZE);
        const imgs = slice.map((idx) => inputs[idx] as MultimodalImageInput);
        try {
          const out = await this.embedCohereImages(imgs, cohereKey, spec.id, dim);
          for (let j = 0; j < slice.length; j++) vectors[slice[j]!] = out[j]!;
        } catch (err) {
          this.logger.warn(
            `Cohere image embed batch ${off}-${off + slice.length} failed: ${(err as Error).message}`,
          );
        }
      }

      return {
        vectors,
        model: spec.id,
        dimensions: dim,
        provider: 'cohere',
      };
    }

    // Path B — no Cohere key. Fall back to the text embedder for
    // text inputs; drop image inputs with a WARN (returned as null
    // so caller skips creating the image chunk). The text path stays
    // text-only — pin (model, dim) is the text spec's, not 1536/
    // Cohere. This deliberately PREVENTS mixing image and text
    // vectors in the same corpus when there's no unified-space
    // model available.
    if (hasImageInputs) {
      this.logger.warn(
        `[multimodal] No Cohere key configured (or no multimodal spec registered) for teacher ${teacherId}; ` +
          `dropping ${inputs.filter((i) => i.kind === 'image').length} image inputs. ` +
          'Configure a Cohere key to enable Stage 05 page_image chunks.',
      );
    }
    const textInputs = inputs.map((i) =>
      i.kind === 'text' ? i.text : '',
    );
    const out = await this.callEmbeddingForUser(teacherId, textInputs);
    const vectors: (number[] | null)[] = inputs.map((i, idx) =>
      i.kind === 'text' ? out.vectors[idx]! : null,
    );
    return {
      vectors,
      model: out.model,
      dimensions: out.dimensions,
      provider: out.provider,
    };
  }

  /** Resolve the teacher's encrypted Cohere key. Same encryption
   *  scheme as `encryptedApiKey` (AES-256-GCM via JWT_SECRET). Never
   *  throws — returns null on missing/bad row. */
  private async resolveCohereKey(teacherId: string): Promise<string | null> {
    try {
      const user = await this.prisma.user.findUnique({
        where: { id: teacherId },
        select: { cohereApiKey: true },
      });
      if (!user?.cohereApiKey) return null;
      return this.decryptApiKey(user.cohereApiKey);
    } catch (err) {
      this.logger.warn(
        `Failed to decrypt Cohere key for teacher ${teacherId}: ${(err as Error).message}`,
      );
      return null;
    }
  }

  /** Cohere v2 /embed — text path. Returns vectors in input order. */
  private async embedCohereText(
    texts: string[],
    apiKey: string,
    model: string,
    outputDimension: number,
    inputType: 'search_document' | 'search_query',
  ): Promise<number[][]> {
    const body = {
      model,
      input_type: inputType,
      embedding_types: ['float'],
      output_dimension: outputDimension,
      texts,
    };
    const response = await fetch(COHERE_EMBED_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cohere /embed text ${response.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      embeddings?: { float?: number[][] } | number[][];
    };
    // Cohere v2 response shape: `embeddings.float: number[][]`. Older
    // v1 returned `embeddings: number[][]` directly — handle both.
    if (Array.isArray((data as any).embeddings)) {
      return (data as any).embeddings as number[][];
    }
    const arr = (data.embeddings as { float?: number[][] } | undefined)?.float;
    if (!Array.isArray(arr)) {
      throw new Error('Cohere /embed text returned no embeddings');
    }
    return arr;
  }

  /** Cohere v2 /embed — multimodal `inputs` path with image content. */
  private async embedCohereImages(
    images: MultimodalImageInput[],
    apiKey: string,
    model: string,
    outputDimension: number,
  ): Promise<number[][]> {
    const body = {
      model,
      input_type: 'search_document',
      embedding_types: ['float'],
      output_dimension: outputDimension,
      // Cohere v2 multimodal request shape per their docs:
      //   inputs: [{ content: [{ type: 'image', image: { url: '<data url>' } }] }]
      // Mediatype prefix is required for the data URL. Each `inputs`
      // entry corresponds to ONE embedding vector — the `content`
      // array is the multimodal payload (we send one image per
      // entry; future stages can interleave text+image for caption-
      // boosted embeddings).
      inputs: images.map((img) => ({
        content: [
          {
            type: 'image',
            image: {
              url: `data:${img.mimeType};base64,${img.bytes.toString('base64')}`,
            },
          },
        ],
      })),
    };

    const response = await fetch(COHERE_EMBED_ENDPOINT, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Cohere /embed image ${response.status}: ${errText.slice(0, 200)}`);
    }
    const data = (await response.json()) as {
      embeddings?: { float?: number[][] } | number[][];
    };
    if (Array.isArray((data as any).embeddings)) {
      return (data as any).embeddings as number[][];
    }
    const arr = (data.embeddings as { float?: number[][] } | undefined)?.float;
    if (!Array.isArray(arr)) {
      throw new Error('Cohere /embed image returned no embeddings');
    }
    return arr;
  }

  /**
   * Embed using a specific (model, provider, key) tuple. The retrieval
   * guard uses this to re-embed a query against the corpus's PINNED
   * model when it differs from the teacher's current default.
   */
  async embedWithSpec(
    texts: string[],
    apiKey: string,
    provider: LlmProvider | 'fallback',
    spec: EmbeddingModelSpec,
    outputDimensions?: number,
  ): Promise<EmbeddingFunnelResult> {
    if (texts.length === 0) {
      return { vectors: [], model: spec.id, dimensions: spec.dimensions, provider: 'fallback' };
    }
    const requestedDim = this.pickOutputDimension(spec, outputDimensions);
    if (provider === 'fallback' || !apiKey) {
      return this.makeFallbackResult(texts, spec.id, requestedDim, 'no API key supplied');
    }
    try {
      if (provider === 'openai') {
        const vectors = await this.embedOpenAI(
          texts,
          apiKey,
          spec.id,
          requestedDim !== spec.dimensions ? requestedDim : undefined,
        );
        return { vectors, model: spec.id, dimensions: requestedDim, provider: 'openai' };
      }
      const vectors = await this.embedGemini(texts, apiKey, spec.id, requestedDim);
      return { vectors, model: spec.id, dimensions: requestedDim, provider: 'gemini' };
    } catch (err) {
      this.logger.error(`embedWithSpec failed: ${(err as Error).message}`);
      return this.makeFallbackResult(
        texts,
        spec.id,
        requestedDim,
        `provider call failed: ${(err as Error).message}`,
      );
    }
  }

  // ─── Fallback helper (Stage 02 Task E) ──────────────────

  /**
   * Build a fallback (SHA256 pseudo-vector) result OR throw if
   * pseudo-embeddings are gated off in this environment. Loud-by-design:
   * every invocation logs a console.warn with the reason so the
   * dev/operator knows retrieval has degraded.
   */
  private makeFallbackResult(
    texts: string[],
    specId: string,
    dim: number,
    reason: string,
  ): EmbeddingFunnelResult {
    if (!pseudoEmbeddingsAllowed()) {
      // Hard fail in production. Caller catches and surfaces a clear
      // operator message — far better than silently storing junk
      // vectors that will quietly poison cosine for the corpus's life.
      throw new PseudoEmbeddingBlockedError(reason);
    }
    this.logger.warn(
      `[RAG] SHA256 pseudo-embedding fallback (${texts.length} texts, dim=${dim}, reason="${reason}"). ` +
        `Retrieval is DEGRADED — set RAG_ALLOW_PSEUDO_EMBEDDINGS=false to fail loudly.`,
    );
    const vectors = texts.map((t) => this.generateFallbackEmbedding(t, dim));
    return {
      vectors,
      // Tag with sentinel model id so chunks persisted under this path
      // are identifiable in the retrieval guard (which surfaces
      // `degradedRetrieval`). Callers that want the registry spec id
      // can read `dimensions` — the dim is honest.
      model: PSEUDO_EMBEDDING_MODEL,
      dimensions: dim,
      provider: 'fallback',
    };
  }

  // ─── Legacy entry points (kept for back-compat) ──────────

  /**
   * Legacy: provider-only embed. Still used by `student-rag-retrieval`
   * and `student-rag.service` for backwards compatibility, but the
   * preferred path is `callEmbeddingForUser` (which is registry-aware).
   * The dimension here is the provider default for the resolved model.
   */
  async embed(texts: string[], apiKey: string, provider: string): Promise<number[][]> {
    if (texts.length === 0) return [];
    const llmProvider: LlmProvider | 'fallback' =
      provider === 'gemini' ? 'gemini' : provider === 'openai' ? 'openai' : 'fallback';
    const spec = defaultEmbeddingModel(llmProvider === 'fallback' ? 'openai' : llmProvider);
    const result = await this.embedWithSpec(texts, apiKey, llmProvider, spec);
    return result.vectors;
  }

  async embedOne(text: string, apiKey: string, provider: string): Promise<number[]> {
    const out = await this.embed([text], apiKey, provider);
    return out[0]!;
  }

  // ─── Dimension resolution ───────────────────────────────

  private pickOutputDimension(
    spec: EmbeddingModelSpec,
    requested: number | undefined,
  ): number {
    if (!requested) return spec.dimensions;
    if (requested === spec.dimensions) return spec.dimensions;
    if (spec.truncatableTo?.includes(requested)) return requested;
    this.logger.warn(
      `Requested embedding dim ${requested} is not in ${spec.id}.truncatableTo; using native ${spec.dimensions}`,
    );
    return spec.dimensions;
  }

  // ─── OpenAI Embeddings ──────────────────────────────────

  private async embedOpenAI(
    texts: string[],
    apiKey: string,
    model: string,
    dimensions?: number,
  ): Promise<number[][]> {
    const allEmbeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += OPENAI_BATCH_SIZE) {
      const batch = texts.slice(i, i + OPENAI_BATCH_SIZE);

      const body: Record<string, unknown> = { model, input: batch };
      // `dimensions` is supported only by `text-embedding-3-*`; legacy
      // ada-002 rejects it. Send only when truncating to a smaller dim.
      if (dimensions) body.dimensions = dimensions;

      const response = await fetch('https://api.openai.com/v1/embeddings', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error(`OpenAI Embeddings API error: ${response.status} ${errorText}`);
        throw new Error(`OpenAI Embeddings API error: ${response.status}`);
      }

      const data = (await response.json()) as {
        data?: Array<{ embedding: number[]; index: number }>;
      };
      if (!data.data) throw new Error('OpenAI Embeddings returned no data');

      const sorted = data.data.sort((a, b) => a.index - b.index);
      allEmbeddings.push(...sorted.map((d) => d.embedding));
    }

    return allEmbeddings;
  }

  // ─── Gemini Embeddings ──────────────────────────────────

  private async embedGemini(
    texts: string[],
    apiKey: string,
    model: string,
    outputDimensionality: number,
  ): Promise<number[][]> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents?key=${apiKey}`;

    const requests = texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      outputDimensionality,
    }));

    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requests }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      this.logger.error(`Gemini Embeddings API error: ${response.status} ${errorText}`);
      throw new Error(`Gemini Embeddings API error: ${response.status}`);
    }

    const data = (await response.json()) as {
      embeddings?: Array<{ values: number[] }>;
    };

    if (!data.embeddings) throw new Error('Gemini Embeddings returned no embeddings');
    return data.embeddings.map((e) => e.values);
  }

  // ─── Fallback Pseudo-Embedding ──────────────────────────

  /**
   * Generate a deterministic pseudo-embedding using a hashing approach
   * at the EXACT dimension the caller asked for. The hash distribution
   * is uniform across `dimension` slots, so retrieval cosine still picks
   * up identical-text matches; otherwise it's semantically meaningless.
   * This is the no-key fallback path — produces storage-compatible
   * vectors so the rest of the pipeline keeps running.
   */
  private generateFallbackEmbedding(text: string, dimension: number): number[] {
    const embedding = new Float64Array(dimension);

    const words = text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length > 1);

    for (const word of words) {
      const hash = crypto.createHash('sha256').update(word).digest();
      for (let i = 0; i < dimension; i++) {
        const byteIndex = i % hash.length;
        embedding[i]! += (hash[byteIndex]! - 128) / 128;
      }
    }

    let magnitude = 0;
    for (let i = 0; i < dimension; i++) {
      magnitude += embedding[i]! * embedding[i]!;
    }
    magnitude = Math.sqrt(magnitude);

    if (magnitude > 0) {
      for (let i = 0; i < dimension; i++) {
        embedding[i]! /= magnitude;
      }
    }

    return Array.from(embedding);
  }

  // ─── Helpers ────────────────────────────────────────────

  private decryptApiKey(encrypted: string): string {
    const secret = process.env.JWT_SECRET || 'dev-secret-change-in-production';
    const key = crypto.scryptSync(secret, 'llm-key-salt', 32);
    const parts = encrypted.split(':');
    const iv = Buffer.from(parts[0]!, 'hex');
    const authTag = Buffer.from(parts[1]!, 'hex');
    const encryptedBuf = Buffer.from(parts[2]!, 'hex');
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    return decipher.update(encryptedBuf) + decipher.final('utf8');
  }
}
