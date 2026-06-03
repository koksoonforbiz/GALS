/**
 * Stage 06 — GroundedEvidenceService unit tests.
 *
 * Contract:
 *  1. Text-only retrieval ⇒ no images, 1-based Source N labels.
 *  2. Image chunk with multimodal ON + under cap ⇒ fetched from blob,
 *     attached as image with `Figure:` label.
 *  3. Image chunk with multimodal OFF ⇒ demoted to caption-as-text.
 *  4. Image chunks beyond the cap ⇒ demoted, top N attached.
 *  5. Blob fetch failure ⇒ degraded to caption-as-text, NEVER throws.
 *  6. Missing image metadata ⇒ degraded to text-citation safely.
 *  7. The combined Source-N numbering is contiguous across the
 *     consumed-as-text outputs (image-demoted chunks count too).
 */

import { GroundedEvidenceService } from './grounded-evidence.service';
import type { ImageChunkMeta } from './grounded-evidence.service';
import type { BlobService } from '../../blob/blob.service';
import type { RetrievedChunk } from '../../student-rag/student-rag-retrieval.service';

function makeBlobMock(
  responses: Record<string, { body: Buffer; contentType: string } | Error>,
): BlobService {
  return {
    get: jest.fn(async (key: string) => {
      const r = responses[key];
      if (!r) throw new Error(`unexpected fetch of ${key}`);
      if (r instanceof Error) throw r;
      return r;
    }),
  } as unknown as BlobService;
}

const tChunk = (id: string, content: string, modality: 'text' | 'image' = 'text'): RetrievedChunk => ({
  chunkId: id,
  documentId: `doc-${id}`,
  documentName: `${id}.pdf`,
  content,
  pageNumber: 1,
  score: 1,
  metadata: {},
  modality,
});

const imgMeta = (id: string, key: string): ImageChunkMeta => ({
  chunkId: id,
  imageObjectKey: key,
  filename: `${id}.pdf`,
  pageNumber: 3,
  caption: `caption for ${id}`,
});

describe('GroundedEvidenceService', () => {
  const origEnv = process.env.RAG_MULTIMODAL_GENERATION;
  afterEach(() => {
    process.env.RAG_MULTIMODAL_GENERATION = origEnv;
    process.env.RAG_MAX_IMAGES_PER_CALL = undefined;
  });

  it('text-only retrieval yields no images and 1-based Source labels', async () => {
    const svc = new GroundedEvidenceService(makeBlobMock({}));
    const out = await svc.buildEvidence(
      [tChunk('c1', 'first chunk'), tChunk('c2', 'second chunk')],
      new Map(),
    );
    expect(out.images).toHaveLength(0);
    expect(out.hasImages).toBe(false);
    expect(out.contextChunks).toHaveLength(2);
    expect(out.contextChunks[0]!.citationLabel).toBe('Source 1: c1.pdf, p.1');
    expect(out.contextChunks[1]!.citationLabel).toBe('Source 2: c2.pdf, p.1');
  });

  it('attaches image bytes when multimodal generation is ON and under cap', async () => {
    process.env.RAG_MULTIMODAL_GENERATION = 'true';
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
    const svc = new GroundedEvidenceService(
      makeBlobMock({ 'images/c1.png': { body: png, contentType: 'image/png' } }),
    );
    const out = await svc.buildEvidence(
      [tChunk('c1', '', 'image')],
      new Map([['c1', imgMeta('c1', 'images/c1.png')]]),
    );
    expect(out.images).toHaveLength(1);
    expect(out.hasImages).toBe(true);
    expect(out.images[0]!.bytes).toEqual(png);
    expect(out.images[0]!.mimeType).toBe('image/png');
    expect(out.images[0]!.citationLabel).toBe('Figure: c1.pdf, p.3');
    expect(out.totalImageBytes).toBe(png.length);
  });

  it('demotes image chunks to caption-as-text when multimodal generation is OFF', async () => {
    process.env.RAG_MULTIMODAL_GENERATION = 'false';
    const svc = new GroundedEvidenceService(makeBlobMock({}));
    const out = await svc.buildEvidence(
      [tChunk('c1', '', 'image')],
      new Map([['c1', imgMeta('c1', 'images/c1.png')]]),
    );
    expect(out.images).toHaveLength(0);
    expect(out.contextChunks).toHaveLength(1);
    expect(out.contextChunks[0]!.text).toBe('caption for c1');
    // Demoted entries get a [Source N: ...] label, not [Figure: ...],
    // because the model can't actually see the image.
    expect(out.contextChunks[0]!.citationLabel).toBe('Source 1: c1.pdf, p.3');
  });

  it('respects the per-call cap: top N attached, rest demoted', async () => {
    process.env.RAG_MULTIMODAL_GENERATION = 'true';
    process.env.RAG_MAX_IMAGES_PER_CALL = '2';
    const blob = makeBlobMock({
      'k1': { body: Buffer.from([1]), contentType: 'image/png' },
      'k2': { body: Buffer.from([2]), contentType: 'image/png' },
      'k3': { body: Buffer.from([3]), contentType: 'image/png' },
    });
    const svc = new GroundedEvidenceService(blob);
    const out = await svc.buildEvidence(
      [tChunk('c1', '', 'image'), tChunk('c2', '', 'image'), tChunk('c3', '', 'image')],
      new Map([
        ['c1', imgMeta('c1', 'k1')],
        ['c2', imgMeta('c2', 'k2')],
        ['c3', imgMeta('c3', 'k3')],
      ]),
    );
    expect(out.images).toHaveLength(2);
    // The 3rd image is demoted but STILL cited (caption-as-text).
    expect(out.contextChunks).toHaveLength(1);
    expect(out.contextChunks[0]!.text).toBe('caption for c3');
  });

  it('triple-defensive: blob fetch failure degrades to caption-as-text, no throw', async () => {
    process.env.RAG_MULTIMODAL_GENERATION = 'true';
    const blob = makeBlobMock({ 'k1': new Error('S3 unreachable') });
    const svc = new GroundedEvidenceService(blob);
    const out = await svc.buildEvidence(
      [tChunk('c1', '', 'image')],
      new Map([['c1', imgMeta('c1', 'k1')]]),
    );
    expect(out.images).toHaveLength(0);
    expect(out.contextChunks).toHaveLength(1);
    expect(out.contextChunks[0]!.text).toBe('caption for c1');
  });

  it('falls back gracefully when image meta is missing for an image chunk', async () => {
    process.env.RAG_MULTIMODAL_GENERATION = 'true';
    const svc = new GroundedEvidenceService(makeBlobMock({}));
    const out = await svc.buildEvidence([tChunk('c1', 'fallback text', 'image')], new Map());
    expect(out.images).toHaveLength(0);
    expect(out.contextChunks).toHaveLength(1);
    expect(out.contextChunks[0]!.text).toBe('fallback text');
  });

  it('text Source N numbering stays contiguous when interleaved with image-demoted chunks', async () => {
    process.env.RAG_MULTIMODAL_GENERATION = 'false';
    const svc = new GroundedEvidenceService(makeBlobMock({}));
    const out = await svc.buildEvidence(
      [
        tChunk('t1', 'first text'),
        tChunk('i1', '', 'image'),
        tChunk('t2', 'second text'),
        tChunk('i2', '', 'image'),
      ],
      new Map([
        ['i1', imgMeta('i1', 'k1')],
        ['i2', imgMeta('i2', 'k2')],
      ]),
    );
    const labels = out.contextChunks.map((c) => c.citationLabel);
    expect(labels).toEqual([
      'Source 1: t1.pdf, p.1',
      'Source 2: i1.pdf, p.3',
      'Source 3: t2.pdf, p.1',
      'Source 4: i2.pdf, p.3',
    ]);
  });
});
