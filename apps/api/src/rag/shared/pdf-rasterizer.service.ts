/**
 * Stage 05 — Backend PDF rasterizer.
 *
 * Renders each page of a PDF buffer to a PNG buffer + dimensions, so
 * the ingest pipeline can persist page images to MinIO and embed them
 * via the multimodal embedding funnel (Cohere Embed 4).
 *
 * Implementation choice:
 *   - Primary: `pdf-img-convert` (pure JS — wraps pdfjs-dist + node-
 *     canvas under the hood). pdfjs-dist is already in `apps/web` so
 *     we know the family of libraries works on this codebase; node-
 *     canvas comes along as a transitive dep. NO native Ghostscript
 *     or GraphicsMagick install required, which keeps the API
 *     deployable container minimal.
 *   - Fallback: if `pdf-img-convert` cannot load (e.g. native canvas
 *     binding failed to build on the target arch), the service
 *     returns an empty page list and logs a single WARN — Stage 05's
 *     triple-defensive contract means ingest continues with text-only
 *     chunks and the operator is told to install the missing dep.
 *
 * Frontier note (TODO Stage 06+):
 *   ColPali / late-interaction multi-vector retrieval would give
 *   per-patch image attention and meaningfully outperform single-
 *   vector page embeddings on dense figures/charts. That requires:
 *     (a) a real vector DB with multi-vector + MaxSim support
 *         (pgvector HNSW + late-interaction, PLAID, Vespa), and
 *     (b) a GPU tier to host the ColPali / ColPali-v2 weights.
 *   We deliberately stay with the single-vector unified-embeddings
 *   substrate (in-memory JSONB cosine) to keep the Stage 04 hot
 *   path untouched. The TODO is documented here AND in
 *   `embedding.service.ts` so the decision is explicit.
 */

import { Injectable, Logger } from '@nestjs/common';

export interface RasterizedPage {
  pageNumber: number;
  pngBuffer: Buffer;
  width: number;
  height: number;
}

export interface RasterizeOptions {
  /** Render DPI. 150 is the spec default — a reasonable trade-off
   *  between figure legibility for VLM captioning and PNG size in
   *  MinIO. Bumping to 200+ multiplies storage by ~1.8x; 100 starts
   *  to lose chart-axis labels. */
  dpi?: number;
  /** Optional hard cap on pages — defensive against a 500-page PDF
   *  blowing up ingest. Default 200 — large enough for any
   *  realistic textbook chapter, small enough that the per-page
   *  Cohere call doesn't run for hours. */
  maxPages?: number;
}

const DEFAULT_DPI = 150;
const DEFAULT_MAX_PAGES = 200;
// pdfjs-dist renders at 72 DPI by default; scale = target / base.
const PDFJS_BASE_DPI = 72;

@Injectable()
export class PdfRasterizerService {
  private readonly logger = new Logger(PdfRasterizerService.name);
  /** Cached require of `pdf-img-convert` so we don't hit the file
   *  system on every page render. `null` means the module failed to
   *  load (logged once on first attempt). */
  private converterModule: { convert: PdfImgConvertFn } | null | undefined = undefined;

  /**
   * Rasterize a PDF buffer to per-page PNG buffers with dimensions.
   * Triple-defensive: any failure (missing native dep, malformed PDF,
   * out-of-memory on a giant page) returns the pages successfully
   * rendered so far + logs a WARN. Never throws — ingest must keep
   * running with text chunks even when image rendering fails.
   */
  async rasterizePdf(
    buffer: Buffer,
    options: RasterizeOptions = {},
  ): Promise<RasterizedPage[]> {
    const dpi = Math.max(72, Math.min(300, options.dpi ?? DEFAULT_DPI));
    const maxPages = Math.max(1, Math.min(1000, options.maxPages ?? DEFAULT_MAX_PAGES));

    const mod = await this.loadConverter();
    if (!mod) {
      this.logger.warn(
        '[pdf-rasterizer] pdf-img-convert not available — skipping image ingest. ' +
          'Install `pdf-img-convert` to enable Stage 05 page_image chunks.',
      );
      return [];
    }

    try {
      // pdf-img-convert `convert` accepts a Uint8Array AND an options
      // bag with { scale, page_numbers }. We don't slice page_numbers
      // upfront (the lib needs to parse the PDF to know page count
      // anyway), but we clamp the returned array to `maxPages`.
      const scale = dpi / PDFJS_BASE_DPI;
      const outputs = await mod.convert(new Uint8Array(buffer), {
        scale,
        base64: false,
      });
      if (!Array.isArray(outputs) || outputs.length === 0) {
        this.logger.warn('[pdf-rasterizer] convert() returned no pages');
        return [];
      }

      const pages: RasterizedPage[] = [];
      const limit = Math.min(outputs.length, maxPages);
      for (let i = 0; i < limit; i++) {
        const out = outputs[i];
        if (!out) continue;
        // pdf-img-convert returns Uint8Array per page when base64=false.
        const pngBuffer = Buffer.isBuffer(out) ? out : Buffer.from(out);
        const dims = this.readPngDimensions(pngBuffer);
        pages.push({
          pageNumber: i + 1,
          pngBuffer,
          width: dims.width,
          height: dims.height,
        });
      }

      if (outputs.length > limit) {
        this.logger.warn(
          `[pdf-rasterizer] PDF has ${outputs.length} pages, capped to ${limit} for ingest`,
        );
      }

      return pages;
    } catch (err) {
      this.logger.warn(
        `[pdf-rasterizer] rasterize failed: ${(err as Error).message}. ` +
          'Falling back to text-only ingest for this document.',
      );
      return [];
    }
  }

  // ─── Internals ─────────────────────────────────────────────

  private async loadConverter(): Promise<{ convert: PdfImgConvertFn } | null> {
    if (this.converterModule !== undefined) return this.converterModule;
    try {
      // Dynamic require so a missing dep doesn't crash Nest bootstrap.
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const mod = require('pdf-img-convert') as {
        convert?: PdfImgConvertFn;
        default?: { convert?: PdfImgConvertFn };
      };
      const convert = mod.convert ?? mod.default?.convert;
      if (typeof convert !== 'function') {
        this.logger.warn(
          '[pdf-rasterizer] pdf-img-convert loaded but no `convert` export found',
        );
        this.converterModule = null;
        return null;
      }
      this.converterModule = { convert };
      return this.converterModule;
    } catch (err) {
      this.logger.warn(
        `[pdf-rasterizer] Failed to load pdf-img-convert: ${(err as Error).message}`,
      );
      this.converterModule = null;
      return null;
    }
  }

  /** Read width/height from a PNG buffer header (bytes 16..23 are the
   *  IHDR width + height, big-endian uint32 each). Avoids pulling in
   *  another image library just for this. Returns (0, 0) when the
   *  buffer doesn't look like a PNG — caller still gets the bytes,
   *  just without dims metadata. */
  private readPngDimensions(buf: Buffer): { width: number; height: number } {
    // PNG signature: 89 50 4E 47 0D 0A 1A 0A
    if (
      buf.length < 24 ||
      buf[0] !== 0x89 ||
      buf[1] !== 0x50 ||
      buf[2] !== 0x4e ||
      buf[3] !== 0x47
    ) {
      return { width: 0, height: 0 };
    }
    const width = buf.readUInt32BE(16);
    const height = buf.readUInt32BE(20);
    return { width, height };
  }
}

// ─── pdf-img-convert typings (no @types package exists) ─────

type PdfImgConvertFn = (
  src: Uint8Array | string,
  opts?: {
    scale?: number;
    width?: number;
    height?: number;
    page_numbers?: number[];
    base64?: boolean;
  },
) => Promise<Array<Uint8Array | Buffer | string>>;
