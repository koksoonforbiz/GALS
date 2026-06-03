/**
 * Stage 05 — Multimodal PDF ingest feature flag.
 *
 * `RAG_MULTIMODAL_PDF` is the global on/off switch. When `false`
 * (default), ingest pipelines behave exactly like Stage 04:
 *   - student PDF: flatten to text chunks only.
 *   - teacher PDF: text chunks + OpenAI Files API handle (kept for
 *     page-content multimodal Q&A).
 *
 * When `true`, the PDF ingest path ALSO rasterizes each page,
 * uploads the PNG to MinIO, embeds it via Cohere Embed 4, captions
 * it via the chat VLM funnel, and persists a `page_image` chunk
 * alongside the text chunks. Retrieval surfaces the image chunks
 * through the existing dense + sparse + RRF + rerank pipeline.
 *
 * Per-course override: `DialogueCourseSettings.multimodalPdf` (Zod
 * `boolean().nullable().optional()`) overrides this env flag for a
 * single course. NULL ⇒ defer to env; `true` / `false` ⇒ explicit
 * per-course force.
 *
 * Default is OFF because:
 *   - rasterization costs CPU + memory per PDF page (~ a few hundred
 *     ms each on modest hardware),
 *   - Cohere Embed 4 is a paid endpoint billed per image, AND
 *   - the VLM caption is a third paid call per page.
 * Operators should flip this on per-course once they've seeded
 * `rag:eval`'s figure/table gold questions and confirmed the lift.
 */

export function multimodalPdfEnabled(perCourseOverride: boolean | null | undefined): boolean {
  if (perCourseOverride === true) return true;
  if (perCourseOverride === false) return false;
  const raw = process.env.RAG_MULTIMODAL_PDF;
  if (raw === undefined) return false;
  const v = raw.toLowerCase().trim();
  return v === 'true' || v === '1' || v === 'on' || v === 'yes';
}
