-- Stage 04 of the RAG upgrade (prompts_rag/04_reranking.md).
--
-- Adds two columns:
--   1. `users.cohere_api_key` — optional encrypted (AES-256-GCM via
--      `LlmService.encrypt`) Cohere API key for the cross-encoder
--      reranker. Separate vendor from the chat LLM
--      (OpenAI/Gemini), so a separate column rather than reusing
--      `encrypted_api_key`. When NULL OR when `RAG_RERANK=false`,
--      the shared retriever falls back to the no-op reranker (RRF
--      order preserved, `reranked: false` flagged on the Coverage
--      panel).
--
--   2. `courses.rerank_top_k` — final top-k after the reranker on
--      the TEACHER corpus retrieval path
--      (`RagService.queryChunksFiltered` → `retrieveTeacher`). The
--      STUDENT corpus uses `dblSettings.rerankTopK` (lives in the
--      Zod-validated dialogue settings JSON, no schema change
--      needed). Range 1-20 (validated server-side by the courses
--      service). Default 8 matches the prior implicit student top-k
--      and is what teacher RAG would have asked for had it had a
--      knob.
--
-- Both columns are additive + nullable / default-safe so existing
-- rows continue to validate without a backfill. Idempotent: `ADD
-- COLUMN IF NOT EXISTS` is supported on PG ≥ 9.6.

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS "cohere_api_key" TEXT;

ALTER TABLE "courses"
  ADD COLUMN IF NOT EXISTS "rerank_top_k" INTEGER NOT NULL DEFAULT 8;
