-- CreateTable
CREATE TABLE "curriculum_coverage_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "status" "EvaluationRunStatus" NOT NULL DEFAULT 'PENDING',
    "syllabus_text" TEXT NOT NULL,
    "parsed_outcomes" JSONB,
    "outcome_kc_maps" JSONB,
    "coverage_results" JSONB,
    "error_message" TEXT,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "curriculum_coverage_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "curriculum_coverage_runs_course_id_idx" ON "curriculum_coverage_runs"("course_id");

-- CreateIndex
CREATE INDEX "curriculum_coverage_runs_user_id_idx" ON "curriculum_coverage_runs"("user_id");
