/**
 * Stage 06 — Shared grounded-generation contract.
 *
 * `buildGroundedMessages` is the single entry point that ALL retrieval
 * surfaces (dialogue, standard/docked chatbot, the four intervention
 * generators) must compose their grounded LLM calls through. It bakes
 * in the same grounding rules + citation format everywhere; the only
 * per-surface variable is `systemPersona`, which slots in front of the
 * fixed contract.
 *
 * Why this exists:
 * Before Stage 06 each surface built its own grounding string and
 * citation guidance, so behaviour drifted (different refusal wording,
 * different citation shape, different evidence shape). Stage 06's
 * acceptance criterion is "same rules everywhere, same citation
 * format, same refusal on not-in-materials". This module owns those
 * rules.
 *
 * Citation format (FIXED across every surface):
 *   - Text chunk:  `[Source N: filename.pdf, p.X]`  (N is 1-based)
 *   - Visual chunk: `[Figure: filename.pdf, p.X]`
 *
 * Images: when retrieval surfaces `page_image`/`figure` chunks
 * (Stage 05) the caller fetches their bytes from MinIO and passes
 * them in via `images[]`. They are attached as
 * `FunnelImageUrlPart` content blocks on the user message so the
 * multimodal LLM (`gpt-4o`-class or Gemini, both handled by the
 * funnel) sees the actual pixels — not just the caption. The image
 * citation label is generated for the model so it can refer back to
 * the visual when discussing what it shows.
 *
 * Triple-defensive: this function NEVER calls the network. It just
 * formats the request shape. Failures upstream (MinIO down, image
 * fetch timeout) should degrade an image to caption-as-text and pass
 * it through `contextChunks` instead — never error the chat call.
 */

import type { FunnelMessage, FunnelContentPart } from '../llm.service';

/** Per-chunk evidence shape consumed by the grounded prompt. */
export interface GroundedContextChunk {
  /** Stable chunk id — used for downstream citation parsing. */
  id: string;
  /** The actual text the model should quote / paraphrase. For
   *  `page_image` / `figure` chunks where text content isn't
   *  meaningful, callers should pass the VLM caption here AS A
   *  LAST-RESORT degradation when the image bytes are missing.
   *  Otherwise leave it short or include a "(see figure)" stub. */
  text: string;
  /** Pre-built citation label, e.g. `Source 1: lecture-2.pdf, p.4`
   *  (the `[` brackets are added by the prompt). The caller must
   *  generate these via {@link buildCitationLabel}. */
  citationLabel: string;
  /** Optional secondary signal. Shown to the model as a hint only —
   *  the prompt itself reminds it that captions are context, not
   *  ground truth. */
  caption?: string;
}

/** Per-image evidence shape consumed by the grounded prompt. */
export interface GroundedImage {
  /** Stable chunk id (same as the corresponding `GroundedContextChunk`
   *  if one was also kept). */
  chunkId: string;
  /** In-process bytes — preferred path. Encoded to a base64 data URL
   *  before being attached to the user message. */
  bytes?: Buffer;
  /** Pre-built presigned URL fallback. Used when `bytes` is absent.
   *  IMPORTANT: only set this if the URL is reachable by BOTH OpenAI
   *  AND Gemini (i.e. a public absolute URL, not the local `/s3/...`
   *  proxy path BlobService normally returns). The OpenAI path takes
   *  `image_url` directly; the Gemini path will fail to inline it
   *  (it expects a data URL), so callers should prefer `bytes`. */
  presignedUrl?: string;
  /** PNG / JPEG. Used to build the data URL when `bytes` is supplied. */
  mimeType: string;
  /** Pre-built citation label without brackets, e.g.
   *  `Figure: lecture-2.pdf, p.4`. */
  citationLabel: string;
  /** Optional VLM caption — shown to the model alongside the image so
   *  it has a textual cue when describing the visual. Caption never
   *  replaces the image: rule baked into the system prompt. */
  caption?: string;
}

export interface BuildGroundedMessagesArgs {
  /** The ONLY per-surface variable. Everything else is fixed. Typical
   *  values: dialogue's `systemPromptOverride`, the chatbot's
   *  strategy-suggesting persona, an intervention's
   *  `InterventionPromptConfig` system prompt. */
  systemPersona: string;
  contextChunks: GroundedContextChunk[];
  images: GroundedImage[];
  history: Array<{ role: 'user' | 'assistant'; content: string }>;
  question: string;
  /**
   * Optional. When `true`, the persona is treated as a strict
   * REPLACEMENT and the shared contract is appended AFTER it. When
   * `false` (default), the persona is appended BEFORE the contract
   * and we add a divider. Both modes end up with the same contract
   * text — the flag only controls where the persona sits in the
   * prompt. Default false matches Stage 05 behaviour.
   */
  personaFirst?: boolean;
}

export interface BuildGroundedMessagesResult {
  systemPrompt: string;
  messages: FunnelMessage[];
}

/**
 * The verbatim grounding contract baked into every grounded surface.
 *
 * Exposed as a const (not just inlined) so tests can assert on its
 * exact wording and other code paths (e.g. faithfulness check) can
 * reference the same rule set.
 */
export const GROUNDING_CONTRACT = [
  'Grounding rules (apply to every answer):',
  '- Answer ONLY from the supplied sources (text + images). Do not use outside knowledge.',
  '- CITE every claim with the source label in this exact format: `[Source N: filename.pdf, p.X]` for text and `[Figure: filename.pdf, p.X]` for visuals.',
  '- If the sources do not contain the answer, say so explicitly and do not guess.',
  '- When referring to a chart or table, describe what the IMAGE shows. Never invent values not visible in the image. Captions are context, not ground truth — rely on the image itself.',
].join('\n');

/** Build the per-chunk citation label that goes in the model's
 *  context block AND that we expect to see echoed in its answer.
 *  Mirror of the regex consumed by the frontend renderer + the
 *  citation extractor — DO NOT change without updating both. */
export function buildCitationLabel(args: {
  /** 1-based index into the retrieved set. Required for `text`
   *  modality (renders as `Source N`). Ignored for `image`. */
  index: number;
  modality: 'text' | 'image';
  filename: string;
  pageNumber: number | null;
}): string {
  const pageStr = args.pageNumber !== null ? `, p.${args.pageNumber}` : '';
  if (args.modality === 'image') {
    return `Figure: ${args.filename}${pageStr}`;
  }
  return `Source ${args.index}: ${args.filename}${pageStr}`;
}

/**
 * Assemble the system prompt + FunnelMessage[] for a grounded LLM
 * call. See module-level docstring for the full contract.
 */
export function buildGroundedMessages(
  args: BuildGroundedMessagesArgs,
): BuildGroundedMessagesResult {
  const { systemPersona, contextChunks, images, history, question } = args;

  // ─── System prompt ──────────────────────────────────────
  // `systemPersona` is the per-surface variable. The contract that
  // follows it is FIXED. Order is persona → divider → contract so a
  // teacher's `systemPromptOverride` (dialogue) or an
  // `InterventionPromptConfig` system prompt sets the tone, then the
  // shared rules constrain it.
  const persona = systemPersona.trim();
  const systemPrompt = args.personaFirst
    ? `${persona}\n\n${GROUNDING_CONTRACT}`
    : persona.length > 0
      ? `${persona}\n\n---\n\n${GROUNDING_CONTRACT}`
      : GROUNDING_CONTRACT;

  // ─── Context block ──────────────────────────────────────
  // The model sees one block per text chunk + one stub per image
  // chunk so it knows the citation label to use when it discusses
  // the figure. The actual image bytes are attached on the user
  // message below.
  // Only list image citations for images whose bytes will actually
  // be attached below — otherwise the model would be told "(see
  // attached image)" for an attachment that was silently dropped.
  // The caller is responsible for having already degraded any
  // un-attachable image to a `contextChunks` caption-as-text entry.
  const attachableImages = images.filter((img) => imageIsAttachable(img));
  const haveAnySource = contextChunks.length > 0 || attachableImages.length > 0;
  const lines: string[] = [];
  if (haveAnySource) {
    lines.push('--- SOURCES ---');
    for (const c of contextChunks) {
      lines.push(`[${c.citationLabel}]`);
      if (c.text && c.text.trim().length > 0) {
        lines.push(c.text.trim());
      }
      if (c.caption && c.caption.trim().length > 0) {
        lines.push(`(caption hint, may be wrong: ${c.caption.trim()})`);
      }
      lines.push('');
    }
    for (const img of attachableImages) {
      lines.push(`[${img.citationLabel}]`);
      lines.push('(see attached image)');
      if (img.caption && img.caption.trim().length > 0) {
        lines.push(`(caption hint, may be wrong: ${img.caption.trim()})`);
      }
      lines.push('');
    }
    lines.push('--- END SOURCES ---');
  }
  const contextBlock = lines.join('\n').trim();

  // ─── History turns ──────────────────────────────────────
  // Emit prior turns as proper role=user / role=assistant message
  // pairs so the LLM can follow the conversation naturally. Flattening
  // into plain text (the old approach) broke follow-up questions like
  // "give me more examples" because the model had no structural signal
  // about what was asked vs. answered.
  const historyMessages: FunnelMessage[] = history.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // ─── Final user message ─────────────────────────────────
  // The current question carries the grounded context + images so the
  // model always has the relevant sources alongside the latest ask.
  // Build content parts: optional context block + question, followed
  // by one `image_url` part per image. The funnel translates
  // `image_url` to Gemini `inlineData` automatically; OpenAI sees it
  // unchanged.
  const userTextParts: string[] = [];
  if (contextBlock.length > 0) {
    userTextParts.push(contextBlock);
  }
  userTextParts.push(question);
  const userText = userTextParts.join('\n\n');

  const contentParts: FunnelContentPart[] = [{ type: 'text', text: userText }];
  for (const img of images) {
    const url = imageToDataUrl(img);
    if (url) {
      contentParts.push({
        type: 'image_url',
        image_url: { url },
      });
    }
    // If neither bytes nor a presigned URL was usable, the image is
    // silently dropped here — the caller is expected to have ALREADY
    // degraded it to a caption-as-text entry in `contextChunks` per
    // the triple-defensive contract. Drop-and-warn is correct
    // behaviour: never error the chat call.
  }

  // When there's only one text part and no images, collapse the
  // parts array to a plain string so the funnel's legacy string
  // detection works (and so older mocks keep matching).
  const userContent: string | FunnelContentPart[] =
    contentParts.length === 1 && contentParts[0]!.type === 'text'
      ? (contentParts[0] as { type: 'text'; text: string }).text
      : contentParts;

  const messages: FunnelMessage[] = [...historyMessages, { role: 'user', content: userContent }];

  return { systemPrompt, messages };
}

/** Build the data URL we attach to the user message for an image.
 *  Prefers in-process bytes; falls back to a pre-signed URL only
 *  when bytes are absent (and only if the URL is something the
 *  provider can fetch directly). */
function imageToDataUrl(img: GroundedImage): string | null {
  if (img.bytes && img.bytes.length > 0) {
    return `data:${img.mimeType};base64,${img.bytes.toString('base64')}`;
  }
  if (img.presignedUrl && /^https?:\/\//i.test(img.presignedUrl)) {
    return img.presignedUrl;
  }
  return null;
}

/** Whether {@link imageToDataUrl} would produce a usable URL. The
 *  context-block builder uses this to skip listing image citations
 *  for images we can't actually attach (otherwise the model is told
 *  to look at an attachment that was silently dropped). */
function imageIsAttachable(img: GroundedImage): boolean {
  return imageToDataUrl(img) !== null;
}
