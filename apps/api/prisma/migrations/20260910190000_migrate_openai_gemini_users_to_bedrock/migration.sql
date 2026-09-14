-- Product decision: teachers can no longer bring their own OpenAI/Gemini
-- API key — Bedrock (one shared server-side credential, AWS_BEARER_TOKEN)
-- is the only selectable LLM provider going forward. This is the data
-- half of that cutover: any account still configured for openai/gemini
-- gets switched to the Bedrock defaults. encrypted_api_key is cleared —
-- Bedrock uses no per-teacher key (see LlmService.saveApiKey) and the
-- old OpenAI/Gemini ciphertext has no further use once the provider can
-- no longer be re-selected.
--
-- NOTE: this does NOT flag affected teachers' document corpora
-- needsReembed=true (unlike LlmService.saveApiKey's normal flow when a
-- teacher voluntarily changes embedding model) — at the time this
-- migration was written, zero accounts in any known environment were
-- actually on openai/gemini (verified against dev), so this was kept as
-- a simple field reassignment rather than replicating
-- markCorporaForReembedIfChanged's SQL. If this ever runs against a
-- database with real openai/gemini accounts, follow up by re-running
-- that re-embed flagging for their corpora — existing embeddings stay
-- queryable but were computed in a different model's vector space.
UPDATE "users"
SET
  llm_provider = 'bedrock',
  encrypted_api_key = NULL,
  llm_model = 'global.openai.gpt-5.6-sol',
  llm_embedding_model = 'global.cohere.embed-v4:0'
WHERE llm_provider IN ('openai', 'gemini');
