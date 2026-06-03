/**
 * Stage 06 — Helpers to bridge raw retriever output and the
 * `GroundedEvidenceService.buildEvidence` API.
 *
 * The retriever returns `RetrievedChunk[]` with `modality`, but
 * doesn't carry `imageObjectKey` / `caption` / `filename` on the
 * chunk shape. Callers normally have to issue one more Prisma round
 * trip to look those up per chunkId before invoking
 * `GroundedEvidenceService.buildEvidence`.
 *
 * These helpers centralise that round trip so the dispatch surfaces
 * (dialogue, chatbot, interventions) all do it the same way.
 */

import type { PrismaService } from '../../prisma/prisma.service';
import type { ImageChunkMeta } from './grounded-evidence.service';
import type { RetrievedChunk } from '../../student-rag/student-rag-retrieval.service';

/**
 * Look up image-chunk metadata for any chunk in `retrieved` whose
 * `modality === 'image'`. Pulls from BOTH the teacher table
 * (`document_chunks` joined to `source_documents`) AND the student
 * table (`student_rag_chunks` joined to `student_source_documents`),
 * keyed by chunkId. Returns a Map suitable for handing to
 * `GroundedEvidenceService.buildEvidence`.
 *
 * Triple-defensive: any individual lookup failure is swallowed —
 * the chunk just won't appear in the map, and the evidence builder
 * will degrade it to caption-as-text. We NEVER throw out of here.
 */
export async function loadImageChunkMetadata(
  prisma: PrismaService,
  retrieved: RetrievedChunk[],
): Promise<Map<string, ImageChunkMeta>> {
  const imageChunkIds = retrieved
    .filter((c) => c.modality === 'image')
    .map((c) => c.chunkId);
  if (imageChunkIds.length === 0) return new Map();

  const out = new Map<string, ImageChunkMeta>();

  // Student-side first (cuid ids in this codebase).
  try {
    const studentChunks = await prisma.studentRagChunk.findMany({
      where: { id: { in: imageChunkIds } },
      select: {
        id: true,
        imageObjectKey: true,
        caption: true,
        pageNumber: true,
        document: { select: { originalName: true } },
      },
    });
    for (const c of studentChunks) {
      if (!c.imageObjectKey) continue;
      out.set(c.id, {
        chunkId: c.id,
        imageObjectKey: c.imageObjectKey,
        filename: c.document?.originalName ?? 'unknown',
        pageNumber: c.pageNumber,
        caption: c.caption,
      });
    }
  } catch {
    /* swallowed — student lookup is best-effort */
  }

  // Teacher-side: ids that didn't resolve student-side.
  const stillMissing = imageChunkIds.filter((id) => !out.has(id));
  if (stillMissing.length > 0) {
    try {
      const teacherChunks = await prisma.documentChunk.findMany({
        where: { id: { in: stillMissing } },
        select: {
          id: true,
          imageObjectKey: true,
          caption: true,
          pageNumber: true,
          document: { select: { filename: true } },
        },
      });
      for (const c of teacherChunks) {
        if (!c.imageObjectKey) continue;
        out.set(c.id, {
          chunkId: c.id,
          imageObjectKey: c.imageObjectKey,
          filename: c.document?.filename ?? 'unknown',
          pageNumber: c.pageNumber,
          caption: c.caption,
        });
      }
    } catch {
      /* swallowed — teacher lookup is best-effort */
    }
  }

  return out;
}
