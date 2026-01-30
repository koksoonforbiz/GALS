-- AlterTable: add LLM settings to users
ALTER TABLE "users" ADD COLUMN "llm_provider" TEXT;
ALTER TABLE "users" ADD COLUMN "encrypted_api_key" TEXT;
ALTER TABLE "users" ADD COLUMN "llm_model" TEXT;
