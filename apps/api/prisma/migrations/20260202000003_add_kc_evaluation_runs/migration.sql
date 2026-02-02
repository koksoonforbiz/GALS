-- CreateTable
CREATE TABLE "kc_evaluation_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "scope" JSONB NOT NULL,
    "depth" TEXT NOT NULL DEFAULT 'quick',
    "results" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kc_evaluation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "kc_evaluation_runs_course_id_idx" ON "kc_evaluation_runs"("course_id");
CREATE INDEX "kc_evaluation_runs_user_id_idx" ON "kc_evaluation_runs"("user_id");
