/**
 * Stage 03 — Contextualizer service (Anthropic Contextual Retrieval).
 *
 * For each chunk, generates a 50-100 token "blurb" that situates the
 * chunk within the parent document (title/section, what the chunk is
 * about, entities/time/units it assumes). The blurb is prepended to the
 * chunk text BEFORE embedding AND BEFORE the lexical (ILIKE/BM25-ish)
 * scan, so retrieval treats each chunk as self-locating. The blurb is
 * stored separately on the chunk row and is NOT shown to the
 * generator — it is a retrieval aid, not content to quote back.
 *
 * Design notes:
 *
 *  - Prompt caching: Anthropic's Contextual Retrieval method relies on
 *    sending the FULL document once as a cached prefix and then the
 *    per-chunk instruction many times, so the marginal cost per chunk
 *    is tiny. Our LLM funnel (`LlmService.callLlmForUser` →
 *    `callLlmStructured` in `apps/api/src/rag/llm.service.ts:702-775`)
 *    talks to OpenAI/Gemini via raw fetch and does NOT yet expose the
 *    provider-native prompt caching APIs (OpenAI `prompt_caching` or
 *    Anthropic `cache_control` blocks). Until it does, we use a
 *    section-scoped fallback: we truncate the document to a ±2000-char
 *    window around the chunk and send THAT as the "doc" context. The
 *    blurb is still document-aware enough to disambiguate most "whose
 *    revenue? which quarter?" cases that pure-chunk embeddings miss,
 *    but the per-chunk LLM call pays for resending the window each
 *    time. Logged as `[contextualize] using section-scoped fallback`.
 *
 *    TODO(stage-04+): When `LlmService.callLlmStructured` gains
 *    prompt-caching support (provider-specific `cache_control` blocks
 *    or OpenAI's `prompt_caching: true`), switch to send-the-doc-once-
 *    per-batch strategy. The function signature here will not change.
 *
 *  - Triple-defensive: ANY failure (rate limit, parse error, API down,
 *    funnel throws, JSON glitch) returns the empty string and logs a
 *    `console.warn`. The caller MUST treat empty as "no context
 *    generated" and fall back to embedding the bare chunk text. Ingest
 *    must NEVER block on contextualisation. This mirrors the
 *    triple-defensive contract from the master plan
 *    (`prompts_rag/00_overview_and_recommendation.md` "House rules").
 *
 *  - Feature flag: callers are responsible for checking
 *    `contextualRetrievalEnabled()` before invoking this service. When
 *    disabled, NO LLM call is made — keeps Stage 02 behaviour exactly.
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm.service';

// ─── Public types ──────────────────────────────────────────────

export interface ContextualizeOptions {
  /** Teacher whose LLM credentials we'll use. The chunk is being
   *  ingested on behalf of this teacher's course (either the teacher's
   *  own SourceDocument or a student doc in a course the teacher
   *  owns). */
  teacherId: string;
  /** Override the funnel-resolved chat model. Unused today (the funnel
   *  picks the teacher's configured chat model); reserved for future
   *  per-task model selection (e.g. always use a cheap model for
   *  contextualisation regardless of the teacher's default). */
  model?: string;
  /** Cap on the blurb length. Anthropic's reference implementation
   *  targets 50-100 tokens; we soft-cap at 150 to leave headroom for
   *  models that round up. */
  maxTokens?: number;
  /** Optional usage-context for cost tracking. Forwarded to the
   *  funnel; the funnel logs into `llm_usage_logs`. */
  usageContext?: { feature: string; courseId?: string; triggeredByUserId?: string };
  /** Optional document title — interpolated into the prompt to anchor
   *  the model. Optional because some callers (e.g. backfill) don't
   *  have it cheaply available. */
  documentTitle?: string;
}

// ─── Internal constants ────────────────────────────────────────

/** Half-width of the section-scoped fallback window, in chars. Total
 *  window the model sees is at most `2 * SECTION_WINDOW_CHARS`. Chosen
 *  to fit comfortably within a single sub-$0.001 OpenAI request even
 *  for 100-char chunks. */
const SECTION_WINDOW_CHARS = 2000;
/** Hard ceiling on the blurb. The prompt asks for 50-100 tokens; the
 *  model funnel maxTokens leaves a small safety margin. */
const DEFAULT_MAX_TOKENS = 150;

/**
 * Feature flag for Stage 03 contextual retrieval. When `false` (the
 * default in dev/test until we verify quality on real corpora), ingest
 * skips contextualisation entirely — no LLM call, no `contextual_text`
 * stored. Retrieval falls back to bare-text behaviour identical to
 * Stage 02.
 *
 * Per-course override: `DialogueCourseSettings.contextualRetrieval`
 * (added in Stage 03 to `packages/shared/src/dialogue.schemas.ts`).
 * The env flag is the global default; the per-course setting overrides
 * it when present.
 */
export function contextualRetrievalEnabled(perCourseOverride?: boolean | null): boolean {
  if (perCourseOverride === true) return true;
  if (perCourseOverride === false) return false;
  const v = (process.env.RAG_CONTEXTUAL_RETRIEVAL ?? 'false').toLowerCase();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}

// ─── Service ───────────────────────────────────────────────────

@Injectable()
export class ContextualizeService {
  private readonly logger = new Logger(ContextualizeService.name);

  constructor(private readonly llmService: LlmService) {}

  /**
   * Generate a short, document-aware context blurb for `chunkText`
   * given the parent document `fullDocText`. Returns the blurb on
   * success, or the EMPTY STRING on any failure (rate limit, parse
   * error, API down, no LLM key, etc.). The caller MUST treat empty
   * as "no context generated" and embed the bare chunk text.
   *
   * Idempotent at the LLM layer (temperature 0). The call itself is
   * not memoised — callers backfilling a large corpus should batch and
   * cache at their level.
   */
  async contextualizeChunk(
    fullDocText: string,
    chunkText: string,
    opts: ContextualizeOptions,
  ): Promise<string> {
    const maxTokens = opts.maxTokens ?? DEFAULT_MAX_TOKENS;

    if (!fullDocText || !chunkText || !chunkText.trim()) {
      // Degenerate inputs — nothing useful to contextualise.
      return '';
    }

    // Section-scoped fallback: build a ±SECTION_WINDOW_CHARS window
    // around the chunk's position within the document. This keeps the
    // per-call cost predictable when prompt caching isn't available.
    // If the chunk isn't found verbatim in the doc (rare — happens
    // with PDF text-extract drift / surrogate stripping), fall back to
    // the doc head + tail.
    const docContext = this.buildSectionContext(fullDocText, chunkText);
    if (docContext.usedFallbackPath) {
      // eslint-disable-next-line no-console
      console.warn(
        '[contextualize] using section-scoped fallback (chunk not found in doc verbatim, used head+tail)',
      );
    }

    const systemPrompt = this.buildSystemPrompt();
    const userPrompt = this.buildUserPrompt(docContext.window, chunkText, opts.documentTitle);

    try {
      const result = await this.llmService.callLlmForUser(
        opts.teacherId,
        systemPrompt,
        userPrompt,
        opts.usageContext ?? { feature: 'rag.contextualize' },
        {
          maxTokens,
          temperature: 0,
        },
      );
      const blurb = (result.content ?? '').trim();
      if (!blurb) {
        // Defensive: a non-throwing empty response (e.g. template
        // fallback path) should not be treated as "successful
        // context". Returning '' makes the caller embed the bare
        // chunk text — same as a hard failure.
        // eslint-disable-next-line no-console
        console.warn('[contextualize] LLM returned empty blurb; falling back to bare chunk');
        return '';
      }
      // Some providers wrap responses in `Context: ...` or `Blurb:`
      // headers despite the system prompt asking otherwise. Strip
      // a single leading label if present.
      return this.cleanBlurb(blurb);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        `[contextualize] LLM call failed; embedding bare chunk: ${(err as Error).message}`,
      );
      return '';
    }
  }

  // ─── Internals ─────────────────────────────────────────────

  private buildSystemPrompt(): string {
    return [
      'You write very short "context blurbs" that situate a text chunk inside a larger document.',
      'Your output will be PREPENDED to the chunk text before vector search and keyword search.',
      'Your output is NEVER shown to the end user. It only helps retrieval find this chunk.',
      '',
      'Rules — follow ALL of them, every time:',
      '- Output 50 to 100 tokens. Be terse. No greetings, no preamble.',
      '- Plain prose only. No bullet points, no markdown, no headers, no labels like "Context:".',
      '- Name the document section / topic this chunk belongs to, in 1 short clause.',
      '- Spell out any entity, time period, unit, or referent that the chunk assumes (e.g.',
      '  "Q3 2024 earnings for Acme Corp" rather than just "Q3").',
      '- Do NOT summarise the chunk verbatim — describe its place in the doc.',
      '- Do NOT invent facts not in the doc context provided.',
    ].join('\n');
  }

  private buildUserPrompt(docWindow: string, chunkText: string, docTitle?: string): string {
    const titleLine = docTitle ? `Document title: ${docTitle}\n\n` : '';
    return [
      `${titleLine}Here is a window of the document around the chunk being indexed:`,
      '<document_window>',
      docWindow,
      '</document_window>',
      '',
      'Here is the chunk to situate:',
      '<chunk>',
      chunkText,
      '</chunk>',
      '',
      'Write a 50-100 token blurb situating this chunk inside the document. Output the blurb only.',
    ].join('\n');
  }

  /**
   * Build a ±SECTION_WINDOW_CHARS window around the chunk's position
   * inside `fullDocText`. Falls back to a head+tail concatenation
   * (with a `... [middle elided] ...` joiner) when the chunk text is
   * not found verbatim — which happens occasionally due to PDF
   * extraction whitespace drift / surrogate replacements applied
   * downstream of chunking.
   */
  private buildSectionContext(
    fullDocText: string,
    chunkText: string,
  ): { window: string; usedFallbackPath: boolean } {
    // Cheap exact-substring probe. Use a prefix slice so we don't bail
    // on small intra-chunk diffs (overlap-prepended chars).
    const probe = chunkText.slice(0, Math.min(80, chunkText.length)).trim();
    const idx = probe ? fullDocText.indexOf(probe) : -1;

    if (idx >= 0) {
      const start = Math.max(0, idx - SECTION_WINDOW_CHARS);
      const end = Math.min(fullDocText.length, idx + chunkText.length + SECTION_WINDOW_CHARS);
      return { window: fullDocText.slice(start, end), usedFallbackPath: false };
    }

    // Fallback: doc head + tail. Keeps the model anchored on
    // title/headers (which usually live at the very start) AND any
    // closing context (refs, summary). For short docs, just return
    // the whole thing.
    if (fullDocText.length <= 2 * SECTION_WINDOW_CHARS) {
      return { window: fullDocText, usedFallbackPath: true };
    }
    const head = fullDocText.slice(0, SECTION_WINDOW_CHARS);
    const tail = fullDocText.slice(-SECTION_WINDOW_CHARS);
    return {
      window: `${head}\n\n... [middle elided] ...\n\n${tail}`,
      usedFallbackPath: true,
    };
  }

  private cleanBlurb(blurb: string): string {
    // Strip a single leading label like "Context: ..." or "Blurb: ..."
    // that some providers add despite the system prompt. Conservative
    // — only strips a SHORT label at the very start, never deeper.
    const stripped = blurb.replace(/^(?:context|blurb|summary)\s*:\s*/i, '').trim();
    // Defensive cap: never let a runaway response inflate per-chunk
    // storage / token budget downstream. ~800 chars is roughly 200
    // tokens — well above our 50-100 target.
    if (stripped.length > 800) return stripped.slice(0, 800);
    return stripped;
  }
}
