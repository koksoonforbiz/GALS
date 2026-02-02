-- CreateTable
CREATE TABLE "publish_gate_runs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "checks" JSONB NOT NULL,
    "overall_pass" BOOLEAN NOT NULL,
    "overridden" BOOLEAN NOT NULL DEFAULT false,
    "override_reason" TEXT,
    "published" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "publish_gate_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publish_gate_runs_course_id_idx" ON "publish_gate_runs"("course_id");

-- CreateIndex
CREATE INDEX "publish_gate_runs_user_id_idx" ON "publish_gate_runs"("user_id");
