-- Add pricing for gpt-5.4-mini (using gpt-4o-mini rates as proxy)
INSERT INTO "llm_model_pricing" ("id", "provider", "model", "input_price_per_1k", "output_price_per_1k", "is_active", "effective_from", "created_at", "updated_at")
VALUES (gen_random_uuid(), 'openai', 'gpt-5.4-mini', 0.00015, 0.0006, true, NOW(), NOW(), NOW())
ON CONFLICT DO NOTHING;
