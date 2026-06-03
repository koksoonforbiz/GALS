/**
 * Stage 06 — Grounded evidence builder.
 *
 * Translates the shared retriever's `RetrievedChunk[]` output into
 * the evidence shape `buildGroundedMessages()` consumes:
 *   - `contextChunks` (text chunks, plus image chunks degraded to
 *     caption-as-text when image bytes can't be fetched OR when
 *     `RAG_MULTIMODAL_GENERATION` is off OR when over the
 *     `RAG_MAX_IMAGES_PER_CALL` cap)
 *   - `images` (image bytes from MinIO, capped, with pre-built
 *     citation labels)
 *
 * Triple-defensive: any failure fetching image bytes from MinIO is
 * swallowed and that chunk degrades to caption-as-text. We log the
 * warning so ops sees it but NEVER throw — this would break the
 * fire-and-forget chat call path.
 *
 * The cap behaviour is "include the top N visual chunks AS images
 * and list the rest AS text citations (caption-only)" per the
 * Stage 06 spec — so an unexpectedly chart-heavy retrieval doesn't
 * silently drop sources, it just demotes them.
 */

import { Injectable, Logger } from '@nestjs/common';
import { BlobService } from '../../blob/blob.service';
import type { RetrievedChunk } from '../../student-rag/student-rag-retrieval.service';
import {
  buildCitationLabel,
  type GroundedContextChunk,
  type GroundedImage,
} from './grounded-prompt';
import {
  maxImagesPerCall,
  multimodalGenerationEnabled,
} from './multimodal-generation.flags';

export interface GroundedEvidence {
  contextChunks: GroundedContextChunk[];
  images: GroundedImage[];
  /** True when at least one image was successfully attached. Used
   *  for token-usage auditing (image input tokens) and for the
   *  "do we have a multimodal call" log line. */
  hasImages: boolean;
  /** Total bytes of attached image content. Used to populate
   *  `tokenUsage.imageInputBytes` on `ChatbotMessage` and
   *  `DialogueMessage` so operators can spot runaway image cost. */
  totalImageBytes: number;
}

export interface BuildEvidenceOptions {
  /** Per-course knob from `DialogueCourseSettings.multimodalGeneration`.
   *  NULL ⇒ defer to env flag. */
  multimodalOverride?: boolean | null;
  /** Per-course knob from `DialogueCourseSettings.maxImagesPerCall`.
   *  NULL ⇒ defer to env. */
  maxImagesOverride?: number | null;
}

/**
 * Internal lookup result for image chunks. Resolves
 * `imageObjectKey` + filename + page number per chunkId so the
 * evidence builder can attach the correct citation label without
 * a second round-trip in the caller.
 */
interface ImageChunkMeta {
  chunkId: string;
  imageObjectKey: string;
  filename: string;
  pageNumber: number | null;
  caption: string | null;
}

@Injectable()
export class GroundedEvidenceService {
  private readonly logger = new Logger(GroundedEvidenceService.name);

  constructor(private readonly blobService: BlobService) {}

  /**
   * Translate the retriever's output into the shared evidence shape.
   *
   * @param retrieved  Ordered list from `retrieveWithMeta` /
   *                   `retrieveTeacher` (already reranked, sliced to
   *                   topK). Order matters: image chunks earlier in
   *                   the list win the cap; the rest demote to text
   *                   citations.
   * @param imageMetaLookup  Per-chunkId metadata for `page_image` /
   *                   `figure` chunks. The caller is responsible for
   *                   fetching `imageObjectKey` + `caption` from the
   *                   DB and the filename from `SourceDocument` /
   *                   `StudentSourceDocument` — this service does NOT
   *                   touch the DB.
   */
  async buildEvidence(
    retrieved: RetrievedChunk[],
    imageMetaLookup: Map<string, ImageChunkMeta>,
    opts: BuildEvidenceOptions = {},
  ): Promise<GroundedEvidence> {
    const multimodalOn = multimodalGenerationEnabled(opts.multimodalOverride);
    const cap = maxImagesPerCall(opts.maxImagesOverride);

    const contextChunks: GroundedContextChunk[] = [];
    const images: GroundedImage[] = [];
    let totalImageBytes = 0;
    let textIndex = 0; // 1-based citation label numbering for text

    // First pass: classify into text/image and bound by the cap.
    // The `textIndex++` happens inline so `Source N` numbering is
    // CONTIGUOUS over the consumed-as-text outputs (image-degraded
    // chunks still get a Source N label so the model can cite them).
    for (const chunk of retrieved) {
      const isImage = chunk.modality === 'image';
      if (!isImage) {
        textIndex += 1;
        contextChunks.push({
          id: chunk.chunkId,
          text: chunk.content,
          citationLabel: buildCitationLabel({
            index: textIndex,
            modality: 'text',
            filename: chunk.documentName || 'unknown',
            pageNumber: chunk.pageNumber,
          }),
        });
        continue;
      }

      // Image chunk.
      const meta = imageMetaLookup.get(chunk.chunkId);
      // Without metadata we can't fetch bytes — degrade to a
      // caption-only text citation so the chunk still gets cited.
      if (!meta) {
        textIndex += 1;
        contextChunks.push({
          id: chunk.chunkId,
          text: chunk.content || '(visual; no caption available)',
          citationLabel: buildCitationLabel({
            index: textIndex,
            modality: 'text',
            filename: chunk.documentName || 'unknown',
            pageNumber: chunk.pageNumber,
          }),
        });
        continue;
      }

      const figureLabel = buildCitationLabel({
        index: 0, // unused for image
        modality: 'image',
        filename: meta.filename,
        pageNumber: meta.pageNumber,
      });

      // Multimodal off OR over cap → demote to caption-as-text.
      // Still cite it; the model needs to know it exists.
      if (!multimodalOn || images.length >= cap) {
        textIndex += 1;
        contextChunks.push({
          id: chunk.chunkId,
          text:
            meta.caption?.trim() ||
            chunk.content ||
            '(visual content; no caption available)',
          // Demoted entries still use [Source N: ...] so the citation
          // shape stays uniform when images aren't attached. The
          // model can't actually SEE the figure, so promoting it to
          // [Figure: ...] would be misleading.
          citationLabel: buildCitationLabel({
            index: textIndex,
            modality: 'text',
            filename: meta.filename,
            pageNumber: meta.pageNumber,
          }),
          caption: meta.caption ?? undefined,
        });
        continue;
      }

      // Multimodal on, under cap → fetch bytes from MinIO.
      const fetched = await this.tryFetchImage(meta.imageObjectKey);
      if (!fetched) {
        // Fetch failed → triple-defensive degradation. Caller
        // (model) still gets a caption-as-text citation; we just
        // warned about the underlying failure in tryFetchImage.
        textIndex += 1;
        contextChunks.push({
          id: chunk.chunkId,
          text:
            meta.caption?.trim() ||
            chunk.content ||
            '(visual content; image fetch failed)',
          citationLabel: buildCitationLabel({
            index: textIndex,
            modality: 'text',
            filename: meta.filename,
            pageNumber: meta.pageNumber,
          }),
          caption: meta.caption ?? undefined,
        });
        continue;
      }

      images.push({
        chunkId: chunk.chunkId,
        bytes: fetched.bytes,
        mimeType: fetched.mimeType,
        citationLabel: figureLabel,
        caption: meta.caption ?? undefined,
      });
      totalImageBytes += fetched.bytes.length;
    }

    return {
      contextChunks,
      images,
      hasImages: images.length > 0,
      totalImageBytes,
    };
  }

  /** Pull bytes from MinIO. Returns null on any failure (logged). */
  private async tryFetchImage(
    objectKey: string,
  ): Promise<{ bytes: Buffer; mimeType: string } | null> {
    try {
      const out = await this.blobService.get(objectKey);
      // Defensive: ensure non-empty body
      if (!out.body || out.body.length === 0) {
        this.logger.warn(
          `grounded-evidence: empty image body for ${objectKey} — degrading to caption`,
        );
        return null;
      }
      // Normalise mime type — page renders are PNG by default but
      // older corpora might have JPEG.
      const mimeType =
        out.contentType && out.contentType !== 'application/octet-stream'
          ? out.contentType
          : 'image/png';
      return { bytes: out.body, mimeType };
    } catch (err) {
      this.logger.warn(
        `grounded-evidence: failed to fetch ${objectKey} — degrading to caption (${(err as Error)?.message ?? err})`,
      );
      return null;
    }
  }
}

export type { ImageChunkMeta };
