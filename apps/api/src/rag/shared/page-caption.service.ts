/**
 * Stage 05 — VLM caption generation for `page_image` / `figure`
 * chunks.
 *
 * The caption is a SECONDARY signal only. Per the Stage 05 spec
 * (`prompts_rag/05_multimodal_pdf_ingest.md` task D):
 *   - It feeds the sparse/ILIKE haystack alongside the chunk content
 *     (see `student-rag-retrieval.service.ts:sparseRetrieval`).
 *   - It is shown to the teacher for QA on the Sources surface.
 *   - It is NEVER the sole grounding for an answer — the real image
 *     is what goes to the generator (Stage 06+).
 *   - It is NEVER quoted as fact in a generated answer.
 *
 * Triple-defensive contract: any failure (provider down, no key,
 * model rejects the image, response unparseable) returns '' and
 * logs a single WARN. The caller persists the empty string and
 * still embeds + retrieves the image chunk — caption-less image
 * chunks are valid, they just lack the lexical-signal boost.
 */

import { Injectable, Logger } from '@nestjs/common';
import { LlmService } from '../llm.service';

export interface CaptionOptions {
  /** Teacher whose chat-LLM key + model the funnel resolves. */
  teacherId: string;
  /** Course context for LLM usage logging. */
  courseId: string;
  /** Page number — included in the prompt so the model has the
   *  textbook/article cue. */
  pageNumber: number;
}

const CAPTION_SYSTEM_PROMPT =
  'You generate concise, factual captions for charts, tables, and figures embedded in academic PDFs. ' +
  'Your output feeds a RAG retrieval index — it must be DESCRIPTIVE and SEARCHABLE, not interpretive. ' +
  'Never invent values. If you cannot read a label cleanly, omit it rather than guessing.';

const CAPTION_USER_PROMPT_TEMPLATE = (pageNumber: number) =>
  `Describe this figure/table/chart briefly (page ${pageNumber}):\n` +
  '- what it shows (chart type, table structure, diagram subject),\n' +
  '- axis labels and units (for charts) OR column/row headers (for tables),\n' +
  '- key values, ranges, or legend entries visible in the image,\n' +
  '- any title or visible figure number.\n\n' +
  'Be concise (≤ 60 words). Do NOT invent values or labels you cannot clearly see. ' +
  'Output a single paragraph; no preamble like "This figure shows".';

@Injectable()
export class PageCaptionService {
  private readonly logger = new Logger(PageCaptionService.name);

  constructor(private readonly llmService: LlmService) {}

  /**
   * Generate a caption for the given PNG/JPEG bytes via the funnel.
   * Returns '' on any failure — caller still embeds the image and
   * stores the empty caption.
   */
  async captionPageImage(
    pngBuffer: Buffer,
    mimeType: 'image/png' | 'image/jpeg' | 'image/webp',
    options: CaptionOptions,
  ): Promise<string> {
    try {
      const dataUrl = `data:${mimeType};base64,${pngBuffer.toString('base64')}`;
      const result = await this.llmService.callLlmStructured(
        options.teacherId,
        {
          systemPrompt: CAPTION_SYSTEM_PROMPT,
          messages: [
            {
              role: 'user',
              content: [
                { type: 'text', text: CAPTION_USER_PROMPT_TEMPLATE(options.pageNumber) },
                { type: 'image_url', image_url: { url: dataUrl } },
              ],
            },
          ],
          maxTokens: 256,
          // No JSON mode — caption is free text. The generator-side
          // prompt explicitly says "no preamble", so we trust the
          // model to comply.
        },
        {
          feature: 'rag.caption.page_image',
          courseId: options.courseId,
        },
      );
      const trimmed = (result.content ?? '').trim();
      if (!trimmed) {
        this.logger.warn(
          `[caption] Empty response from ${result.provider ?? 'template'} for page ${options.pageNumber}`,
        );
        return '';
      }
      // Hard cap defense — the prompt asks for ≤60 words but models
      // occasionally over-run. Truncate to ~600 chars so a runaway
      // caption can't blow up the lexical scan or the teacher QA UI.
      return trimmed.length > 600 ? `${trimmed.slice(0, 597)}...` : trimmed;
    } catch (err) {
      this.logger.warn(
        `[caption] generation threw for page ${options.pageNumber}: ${(err as Error).message}`,
      );
      return '';
    }
  }
}
