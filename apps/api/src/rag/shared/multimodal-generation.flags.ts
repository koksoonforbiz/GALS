/**
 * Stage 06 — Multimodal grounded generation feature flags.
 *
 * `RAG_MULTIMODAL_GENERATION` — global on/off for passing retrieved
 * image bytes to the LLM as content blocks. When `false` (default),
 * `page_image` / `figure` chunks fall back to caption-as-text and
 * behaviour is byte-identical to Stage 05. When `true`, the retrieved
 * images are fetched from MinIO and attached as
 * `FunnelImageUrlPart` content blocks so the multimodal LLM can
 * actually see the figure / chart / table.
 *
 * `RAG_MAX_IMAGES_PER_CALL` — cap on how many images get attached per
 * generation call. Defaults to 4. If reranking surfaces more than the
 * cap, the top N are attached as IMAGES and the remainder are listed
 * as text citations so they still get cited (their caption is shown
 * to the model so it knows what they contain).
 *
 * `RAG_FAITHFULNESS_CHECK` — global default for the post-generation
 * faithfulness self-check. The per-surface override is:
 *   - chat (latency-sensitive) → OFF by default
 *   - intervention generation → ON by default
 * The flag overrides the per-surface default when set.
 *
 * Per-course override:
 *   `DialogueCourseSettings.multimodalGeneration: boolean | null`
 *   `DialogueCourseSettings.faithfulnessCheck: boolean | null`
 * NULL ⇒ defer to env. Today we read env only; the per-course knob
 * is plumbed by callers when DialogueCourseSettings is in scope.
 */

function readBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined) return fallback;
  const v = raw.toLowerCase().trim();
  if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
  if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  return fallback;
}

export function multimodalGenerationEnabled(
  perCourseOverride?: boolean | null,
): boolean {
  if (perCourseOverride === true) return true;
  if (perCourseOverride === false) return false;
  return readBoolEnv('RAG_MULTIMODAL_GENERATION', false);
}

/** Cap on images per call. Hard floor 0, hard ceiling 10. */
export function maxImagesPerCall(perCourseOverride?: number | null): number {
  const raw =
    typeof perCourseOverride === 'number'
      ? perCourseOverride
      : Number(process.env.RAG_MAX_IMAGES_PER_CALL ?? '4');
  if (!Number.isFinite(raw) || raw < 0) return 4;
  return Math.min(Math.max(Math.floor(raw), 0), 10);
}

/** Faithfulness check defaults differ per surface. */
export type FaithfulnessSurface = 'chat' | 'intervention';

export function faithfulnessCheckEnabled(
  surface: FaithfulnessSurface,
  perCallOverride?: boolean | null,
  perCourseOverride?: boolean | null,
): boolean {
  if (perCallOverride === true) return true;
  if (perCallOverride === false) return false;
  if (perCourseOverride === true) return true;
  if (perCourseOverride === false) return false;
  const raw = process.env.RAG_FAITHFULNESS_CHECK;
  if (raw !== undefined) {
    const v = raw.toLowerCase().trim();
    if (v === 'true' || v === '1' || v === 'on' || v === 'yes') return true;
    if (v === 'false' || v === '0' || v === 'off' || v === 'no') return false;
  }
  // Per-surface default.
  return surface === 'intervention';
}
