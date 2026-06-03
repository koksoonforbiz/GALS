-- Stage 02 of the RAG upgrade (prompts_rag/02_unify_text_retrieval_substrate.md).
--
-- Adds `embedding_version` to the per-chunk and per-document tables so a
-- model rollout (same `embedding_model` id, different request semantics
-- — e.g. a Matryoshka truncation flip, or a future "ada-002 v2"-style
-- rollup) can be detected by the retrieval guard without changing the
-- `embedding_model` string.
--
-- This is a separate concept from `embedding_model` (which identifies
-- the provider model id) — `embedding_version` is OUR rollout tag.
-- Today we leave it NULL for all newly stamped rows; future stages will
-- start populating it (e.g. when Stage 05 multimodal vectors land, we'd
-- tag them with `embedding_version = 'multimodal-v1'` so retrieval can
-- group text-only and multimodal corpora separately even if the
-- underlying model id is shared).
--
-- All new columns are nullable with no default so existing rows
-- continue to validate. Safe to re-run because `ADD COLUMN IF NOT
-- EXISTS` is supported by PostgreSQL.

ALTER TABLE "source_documents"
  ADD COLUMN IF NOT EXISTS "embedding_version" TEXT;

ALTER TABLE "document_chunks"
  ADD COLUMN IF NOT EXISTS "embedding_version" TEXT;

ALTER TABLE "student_source_documents"
  ADD COLUMN IF NOT EXISTS "embedding_version" TEXT;

ALTER TABLE "student_rag_chunks"
  ADD COLUMN IF NOT EXISTS "embedding_version" TEXT;
