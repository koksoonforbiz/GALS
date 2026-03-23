-- AlterTable: Add onboarding fields to users
ALTER TABLE "users" ADD COLUMN "is_temporary_password" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "invited_by" UUID;
ALTER TABLE "users" ADD COLUMN "invited_at" TIMESTAMPTZ;
ALTER TABLE "users" ADD COLUMN "password_changed_at" TIMESTAMPTZ;

-- CreateTable: LLM Usage Logs
CREATE TABLE "llm_usage_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "course_id" UUID,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_tokens" INTEGER NOT NULL,
    "output_tokens" INTEGER NOT NULL,
    "total_tokens" INTEGER NOT NULL,
    "input_cost" DOUBLE PRECISION NOT NULL,
    "output_cost" DOUBLE PRECISION NOT NULL,
    "total_cost" DOUBLE PRECISION NOT NULL,
    "feature" TEXT NOT NULL,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_usage_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: LLM Model Pricing
CREATE TABLE "llm_model_pricing" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "input_price_per_1k" DOUBLE PRECISION NOT NULL,
    "output_price_per_1k" DOUBLE PRECISION NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "effective_from" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "llm_model_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_usage_logs_user_id_idx" ON "llm_usage_logs"("user_id");
CREATE INDEX "llm_usage_logs_course_id_idx" ON "llm_usage_logs"("course_id");
CREATE INDEX "llm_usage_logs_created_at_idx" ON "llm_usage_logs"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "llm_model_pricing_provider_model_effective_from_key" ON "llm_model_pricing"("provider", "model", "effective_from");

-- AddForeignKey
ALTER TABLE "llm_usage_logs" ADD CONSTRAINT "llm_usage_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed default model pricing
INSERT INTO "llm_model_pricing" ("id", "provider", "model", "input_price_per_1k", "output_price_per_1k", "is_active", "effective_from", "created_at", "updated_at") VALUES
  (gen_random_uuid(), 'openai', 'gpt-4o',           0.0025,    0.01,     true, NOW(), NOW(), NOW()),
  (gen_random_uuid(), 'openai', 'gpt-4o-mini',      0.00015,   0.0006,   true, NOW(), NOW(), NOW()),
  (gen_random_uuid(), 'openai', 'gpt-4-turbo',      0.01,      0.03,     true, NOW(), NOW(), NOW()),
  (gen_random_uuid(), 'openai', 'gpt-3.5-turbo',    0.0005,    0.0015,   true, NOW(), NOW(), NOW()),
  (gen_random_uuid(), 'gemini', 'gemini-2.0-flash',           0.0001,  0.0004,  true, NOW(), NOW(), NOW()),
  (gen_random_uuid(), 'gemini', 'gemini-2.0-flash-lite',      0.000075, 0.0003, true, NOW(), NOW(), NOW()),
  (gen_random_uuid(), 'gemini', 'gemini-2.5-flash-preview-05-20', 0.00015, 0.0035, true, NOW(), NOW(), NOW()),
  (gen_random_uuid(), 'gemini', 'gemini-2.5-pro-preview-05-06',   0.00125, 0.01,   true, NOW(), NOW(), NOW());
