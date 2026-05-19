-- CreateEnum
CREATE TYPE "EvaluationRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "evaluation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "config" JSONB NOT NULL,
    "summary" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "page_eval_results" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "run_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_title" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "issues" JSONB NOT NULL,
    "math_issues" JSONB,
    "fixes_applied" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "page_eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndexes
CREATE INDEX "evaluation_runs_course_id_idx" ON "evaluation_runs"("course_id");
CREATE INDEX "evaluation_runs_user_id_idx" ON "evaluation_runs"("user_id");
CREATE INDEX "page_eval_results_run_id_idx" ON "page_eval_results"("run_id");
CREATE INDEX "page_eval_results_item_id_idx" ON "page_eval_results"("item_id");

-- AddForeignKey
ALTER TABLE "page_eval_results" ADD CONSTRAINT "page_eval_results_run_id_fkey"
    FOREIGN KEY ("run_id") REFERENCES "evaluation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
