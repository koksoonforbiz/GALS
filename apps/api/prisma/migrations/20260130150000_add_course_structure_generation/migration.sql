-- CreateEnum
CREATE TYPE "GenerationJobStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "llm_generation_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "GenerationJobStatus" NOT NULL DEFAULT 'PENDING',
    "job_type" TEXT NOT NULL,
    "input_payload" JSONB NOT NULL,
    "output_payload" JSONB,
    "retrieved_chunk_ids" JSONB,
    "error_message" TEXT,
    "model" TEXT,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "llm_generation_jobs_course_id_idx" ON "llm_generation_jobs"("course_id");
CREATE INDEX "llm_generation_jobs_user_id_idx" ON "llm_generation_jobs"("user_id");
CREATE INDEX "llm_generation_jobs_status_idx" ON "llm_generation_jobs"("status");

-- AlterTable: Add topicId and generationJobId to course_modules
ALTER TABLE "course_modules" ADD COLUMN "topic_id" UUID;
ALTER TABLE "course_modules" ADD COLUMN "generation_job_id" UUID;

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_topic_id_fkey"
    FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateIndex
CREATE INDEX "course_modules_topic_id_idx" ON "course_modules"("topic_id");

-- AlterTable: Add generationJobId to topics
ALTER TABLE "topics" ADD COLUMN "generation_job_id" UUID;

-- AlterTable: Add AI metadata to module_items
ALTER TABLE "module_items" ADD COLUMN "learning_outcomes" JSONB;
ALTER TABLE "module_items" ADD COLUMN "estimated_minutes" INTEGER;
ALTER TABLE "module_items" ADD COLUMN "generation_job_id" UUID;
