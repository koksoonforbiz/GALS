-- Stage 2 of the LLM provider upgrade (LLM_20260602/stage2_*).
--
-- Two related concerns in one additive migration:
--   1. Add `llm_embedding_model` to `users` so a teacher can pick their
--      preferred embedding model separately from the chat model. Stage
--      1 introduced the registry; Stage 2 wires it. Existing teachers
--      remain on the legacy default (`text-embedding-ada-002`) until
--      they actively change this field — read-time code falls back to
--      the registry default for the provider when the value is NULL.
--   2. Pin the embedding model + dimensions per document / per chunk
--      across both the teacher and student corpora. Retrieval cosine
--      runs in-memory over JSONB vectors that MUST share dimensionality
--      within a single corpus; if a teacher later changes their
--      embedding-model preference we mark `needs_reembed = TRUE` on the
--      parent doc rows so Stage 3's worker can re-embed. We DO NOT
--      re-embed here.
--
-- All new columns are nullable or have safe defaults so existing rows
-- continue to validate. Backfill statements at the bottom set the
-- legacy values (`text-embedding-ada-002` / 1536) for any pre-existing
-- chunks so they can be cross-checked against a teacher's current
-- selection.
--
-- House style: additive only, no data loss. Safe to re-run because
-- ADD COLUMN IF NOT EXISTS is supported by PostgreSQL and the backfill
-- statements are filtered to "value IS NULL".

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "llm_embedding_model" TEXT;

ALTER TABLE "source_documents"
  ADD COLUMN IF NOT EXISTS "embedding_model" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding_dimensions" INTEGER,
  ADD COLUMN IF NOT EXISTS "needs_reembed" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "embedding_model" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding_dimensions" INTEGER;

ALTER TABLE "student_source_documents"
  ADD COLUMN IF NOT EXISTS "embedding_model" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding_dimensions" INTEGER,
  ADD COLUMN IF NOT EXISTS "needs_reembed" BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE "student_rag_chunks"
  ADD COLUMN IF NOT EXISTS "embedding_model" TEXT,
  ADD COLUMN IF NOT EXISTS "embedding_dimensions" INTEGER;

-- ── Backfill ─────────────────────────────────────────────────────────
--
-- The legacy embedding pipeline hard-coded OpenAI `text-embedding-ada-002`
-- at 1536 dims (see `apps/api/src/student-rag/embedding.service.ts:48`
-- and `EMBEDDING_DIMENSION = 1536` on line 4). Gemini was overridden via
-- `outputDimensionality: 1536` to match storage layout, so every existing
-- chunk — regardless of provider — is 1536-dim and storage-compatible
-- with ada-002. We tag them all uniformly as ada-002/1536 here. Stage 3
-- will refine per-provider after the embedding service becomes
-- provider-/model-aware.
--
-- Only chunks that already have an `embedding` JSON payload get tagged;
-- chunks waiting on embedding (queued but unprocessed) stay NULL so the
-- worker can pick the right model at processing time.

UPDATE "document_chunks"
SET "embedding_model" = 'text-embedding-ada-002',
    "embedding_dimensions" = 1536
WHERE "embedding_model" IS NULL
  AND "embedding" IS NOT NULL;

UPDATE "source_documents" sd
SET "embedding_model" = 'text-embedding-ada-002',
    "embedding_dimensions" = 1536
WHERE sd."embedding_model" IS NULL
  AND EXISTS (
    SELECT 1 FROM "document_chunks" dc
    WHERE dc."document_id" = sd."id"
      AND dc."embedding" IS NOT NULL
  );

UPDATE "student_rag_chunks"
SET "embedding_model" = 'text-embedding-ada-002',
    "embedding_dimensions" = 1536
WHERE "embedding_model" IS NULL
  AND "embedding" IS NOT NULL;

UPDATE "student_source_documents" ssd
SET "embedding_model" = 'text-embedding-ada-002',
    "embedding_dimensions" = 1536
WHERE ssd."embedding_model" IS NULL
  AND EXISTS (
    SELECT 1 FROM "student_rag_chunks" src
    WHERE src."document_id" = ssd."id"
      AND src."embedding" IS NOT NULL
  );
