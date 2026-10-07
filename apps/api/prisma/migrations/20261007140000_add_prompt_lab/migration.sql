-- Prompting-course Prompt Lab (Phase 3). Additive only: new ActivityAction
-- values and five prompt_lab_* tables.

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'RUN_SETTINGS_RECORDED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PROMPT_GOAL_DECLARED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PROMPT_SUBMITTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'OUTPUT_REGENERATED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'AI_OUTPUT_VIEWED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PROMPT_VERSION_SAVED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'PROMPT_REVISION_TAGGED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'TOKEN_COUNT_CHECKED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'TEST_CASE_RUN';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'TEST_RESULT_RECORDED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'OUTPUT_RATED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'OUTPUT_VERIFIED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'OUTPUT_COPIED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'OUTPUT_PASTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'OUTPUT_EDITED';

CREATE TABLE "prompt_lab_runs" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "student_session_id" UUID,
    "course_id" UUID NOT NULL,
    "module_item_id" UUID NOT NULL,
    "slide_key" TEXT NOT NULL,
    "version_id" UUID,
    "version_no" INTEGER,
    "parent_run_id" UUID,
    "test_case_key" TEXT,
    "declared_experiment" BOOLEAN NOT NULL DEFAULT false,
    "sample_no" INTEGER NOT NULL DEFAULT 1,
    "prompt_text" TEXT NOT NULL,
    "system_text" TEXT,
    "model" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "temperature" DOUBLE PRECISION,
    "max_tokens" INTEGER,
    "tools_enabled" BOOLEAN NOT NULL DEFAULT false,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "response_text" TEXT NOT NULL,
    "latency_ms" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_lab_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prompt_lab_versions" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "module_item_id" UUID NOT NULL,
    "slide_key" TEXT NOT NULL,
    "version_no" INTEGER NOT NULL,
    "prompt_text" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL,
    "token_count_source" TEXT NOT NULL DEFAULT 'approx_chars4',
    "revision_tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "diff_from_prev" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_lab_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prompt_lab_test_cases" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "module_item_id" UUID NOT NULL,
    "slide_key" TEXT NOT NULL,
    "case_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "input_text" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_lab_test_cases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prompt_lab_test_results" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "version_id" UUID NOT NULL,
    "run_id" UUID,
    "test_case_key" TEXT NOT NULL,
    "pass" BOOLEAN NOT NULL,
    "failure_reason" TEXT,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_lab_test_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prompt_lab_output_ratings" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "criteria" JSONB NOT NULL,
    "verified_claim" TEXT,
    "verify_verdict" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_lab_output_ratings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "prompt_lab_runs_student_id_module_item_id_slide_key_idx" ON "prompt_lab_runs"("student_id", "module_item_id", "slide_key");

CREATE INDEX "prompt_lab_runs_student_id_created_at_idx" ON "prompt_lab_runs"("student_id", "created_at");

CREATE INDEX "prompt_lab_runs_course_id_created_at_idx" ON "prompt_lab_runs"("course_id", "created_at");

CREATE UNIQUE INDEX "prompt_lab_versions_student_id_module_item_id_slide_key_ver_key" ON "prompt_lab_versions"("student_id", "module_item_id", "slide_key", "version_no");

CREATE UNIQUE INDEX "prompt_lab_test_cases_student_id_module_item_id_slide_key_c_key" ON "prompt_lab_test_cases"("student_id", "module_item_id", "slide_key", "case_key");

CREATE UNIQUE INDEX "prompt_lab_test_results_version_id_test_case_key_key" ON "prompt_lab_test_results"("version_id", "test_case_key");

ALTER TABLE "prompt_lab_runs" ADD CONSTRAINT "prompt_lab_runs_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_runs" ADD CONSTRAINT "prompt_lab_runs_module_item_id_fkey" FOREIGN KEY ("module_item_id") REFERENCES "module_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_versions" ADD CONSTRAINT "prompt_lab_versions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_versions" ADD CONSTRAINT "prompt_lab_versions_module_item_id_fkey" FOREIGN KEY ("module_item_id") REFERENCES "module_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_test_cases" ADD CONSTRAINT "prompt_lab_test_cases_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_test_cases" ADD CONSTRAINT "prompt_lab_test_cases_module_item_id_fkey" FOREIGN KEY ("module_item_id") REFERENCES "module_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_test_results" ADD CONSTRAINT "prompt_lab_test_results_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_test_results" ADD CONSTRAINT "prompt_lab_test_results_version_id_fkey" FOREIGN KEY ("version_id") REFERENCES "prompt_lab_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_output_ratings" ADD CONSTRAINT "prompt_lab_output_ratings_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "prompt_lab_output_ratings" ADD CONSTRAINT "prompt_lab_output_ratings_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "prompt_lab_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
