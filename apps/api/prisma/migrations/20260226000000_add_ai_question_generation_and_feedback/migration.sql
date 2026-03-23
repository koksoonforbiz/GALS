-- CreateEnum
CREATE TYPE "QuestionGenJobStatus" AS ENUM ('PENDING', 'RETRIEVING', 'GENERATING', 'REVIEW_READY', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "HattieFeedbackLevel" AS ENUM ('TASK', 'PROCESS', 'SELF_REGULATION', 'SELF');

-- AlterTable: Question - add AI generation fields
ALTER TABLE "questions" ADD COLUMN "answer_key" JSONB,
ADD COLUMN "difficulty_confidence" DOUBLE PRECISION,
ADD COLUMN "grading_config" JSONB;

-- AlterTable: QuestionKc - add auto-assignment tracking
ALTER TABLE "question_kcs" ADD COLUMN "is_auto_assigned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "confidence" DOUBLE PRECISION;

-- AlterTable: GradingResult - add structured AI feedback
ALTER TABLE "grading_results" ADD COLUMN "ai_feedback_json" JSONB;

-- CreateTable: QuestionGenerationJob
CREATE TABLE "question_generation_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "status" "QuestionGenJobStatus" NOT NULL DEFAULT 'PENDING',
    "source_document_ids" JSONB NOT NULL,
    "source_chunks" JSONB,
    "question_types" JSONB NOT NULL,
    "question_count" INTEGER NOT NULL,
    "difficulty_mix" JSONB,
    "additional_instructions" TEXT,
    "generated_questions" JSONB,
    "approved_count" INTEGER NOT NULL DEFAULT 0,
    "rejected_count" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "question_generation_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: FeedbackPromptConfig
CREATE TABLE "feedback_prompt_configs" (
    "id" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "teacher_id" UUID NOT NULL,
    "feedback_level" "HattieFeedbackLevel" NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "is_custom" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "feedback_prompt_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable: CourseFeedbackSetting
CREATE TABLE "course_feedback_settings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "enabled_levels" JSONB NOT NULL DEFAULT '["TASK"]',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "course_feedback_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "question_generation_jobs_course_id_idx" ON "question_generation_jobs"("course_id");
CREATE INDEX "question_generation_jobs_teacher_id_idx" ON "question_generation_jobs"("teacher_id");
CREATE INDEX "question_generation_jobs_status_idx" ON "question_generation_jobs"("status");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_prompt_configs_course_id_feedback_level_key" ON "feedback_prompt_configs"("course_id", "feedback_level");

-- CreateIndex
CREATE UNIQUE INDEX "course_feedback_settings_course_id_key" ON "course_feedback_settings"("course_id");

-- AddForeignKey
ALTER TABLE "question_generation_jobs" ADD CONSTRAINT "question_generation_jobs_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback_prompt_configs" ADD CONSTRAINT "feedback_prompt_configs_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
