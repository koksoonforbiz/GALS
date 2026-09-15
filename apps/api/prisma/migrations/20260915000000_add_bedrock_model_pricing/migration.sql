-- Pricing rows for the Bedrock models this deployment actually uses.
-- Without these, calculateCost() found no row for provider='bedrock',
-- returned $0 for every call, and the LLM_DAILY_COST_CAP_USD circuit
-- breaker silently never triggered for Bedrock — the production
-- provider (caught by the §2 live smoke test on 2026-09-15).
--
-- Rates are PROXIES (gpt-4o's published per-1k rates for the chat
-- model; a typical embeddings rate for embed-v4) so the breaker is
-- live rather than inert. Replace with the real AWS Bedrock price
-- sheet for ap-southeast-1 before go-live; an admin can also adjust
-- them at runtime via the user-management pricing endpoints.
INSERT INTO "llm_model_pricing" ("id", "provider", "model", "input_price_per_1k", "output_price_per_1k", "is_active", "effective_from", "created_at", "updated_at")
VALUES
  (gen_random_uuid(), 'bedrock', 'global.openai.gpt-5.6-sol', 0.0025, 0.01, true, NOW(), NOW(), NOW()),
  (gen_random_uuid(), 'bedrock', 'global.cohere.embed-v4:0', 0.0001, 0, true, NOW(), NOW(), NOW())
ON CONFLICT DO NOTHING;
