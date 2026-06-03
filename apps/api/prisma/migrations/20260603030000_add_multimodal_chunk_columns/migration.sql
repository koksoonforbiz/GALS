-- Stage 05 of the RAG upgrade (prompts_rag/05_multimodal_pdf_ingest.md).
--
-- Adds four columns to BOTH chunk tables so charts/tables/figures
-- become first-class retrieval objects in the SAME vector space as
-- text chunks. The same in-memory cosine loop scores text and image
-- chunks against the same 1536-dim query vector (Cohere Embed 4
-- Matryoshka output_dimension=1536) — no second index, no second
-- retriever, no schema branching downstream.
--
--   1. `chunk_kind TEXT` — discriminator. Values:
--        'text'        → existing/legacy rows (implicit when NULL)
--        'page_image'  → full-page rasterized PNG embedded as an image
--        'figure'      → a cropped figure/table region (MVP renders
--                        nothing here; reserved for Stage 06+ when
--                        layout detection lands).
--      Nullable + no default so existing rows continue to validate
--      without a backfill — the retriever treats `NULL` and `'text'`
--      identically (see `student-rag-retrieval.service.ts`).
--
--   2. `image_object_key TEXT` — MinIO key for the rendered PNG
--      (`{teacher|student}-docs/{owner}/{courseId}/{docId}/pages/
--      {pageNumber}.png` mirroring the existing convention). NULL for
--      `text` chunks. The caption-generation, VLM rerank, and any
--      future figure UI all fetch the PNG via `BlobService.get(key)`.
--
--   3. `page_number INTEGER` — already exists on `document_chunks`
--      and `student_rag_chunks`, but the Stage 05 ingest path now
--      populates it for `page_image` chunks too so the teacher /
--      student PDF reader can deep-link a citation directly to the
--      page. No schema change for this column — listed here for the
--      reviewer's sanity check.
--
--   4. `caption TEXT` — VLM-generated description of the figure
--      (axis labels, table headers, key values). SECONDARY SIGNAL
--      ONLY (Stage 05 spec): feeds the sparse/ILIKE haystack and is
--      shown to the teacher for QA, but is NEVER quoted as fact in
--      a generated answer (the real image goes to the generator in
--      Stage 06+). NULL means caption generation failed or the
--      feature flag is off — image chunk still gets embedded and
--      retrieved, just without the lexical-signal boost.
--
-- All columns are additive + nullable / default-safe so existing
-- rows continue to validate without a backfill. Idempotent: `ADD
-- COLUMN IF NOT EXISTS` is supported on PG ≥ 9.6.

ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "chunk_kind" TEXT,
  ADD COLUMN IF NOT EXISTS "image_object_key" TEXT,
  ADD COLUMN IF NOT EXISTS "caption" TEXT;

ALTER TABLE "student_rag_chunks"
  ADD COLUMN IF NOT EXISTS "chunk_kind" TEXT,
  ADD COLUMN IF NOT EXISTS "image_object_key" TEXT,
  ADD COLUMN IF NOT EXISTS "caption" TEXT;

-- Lightweight index on the discriminator so the retriever can WHERE-
-- filter to a single modality when the flag flips it on/off without
-- a full table scan. Partial-index style — only rows where the kind
-- was explicitly stamped get indexed, keeping the legacy text rows
-- out of the btree.
CREATE INDEX IF NOT EXISTS "document_chunks_chunk_kind_idx"
  ON "document_chunks" ("chunk_kind")
  WHERE "chunk_kind" IS NOT NULL;

CREATE INDEX IF NOT EXISTS "student_rag_chunks_chunk_kind_idx"
  ON "student_rag_chunks" ("chunk_kind")
  WHERE "chunk_kind" IS NOT NULL;
