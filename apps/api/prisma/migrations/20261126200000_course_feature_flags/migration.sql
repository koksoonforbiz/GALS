-- Prompt B, P5d: learner-visible prompt switches per course (additive only).
CREATE TABLE IF NOT EXISTS "course_feature_flags" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "flag" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "changed_by" UUID,
    CONSTRAINT "course_feature_flags_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "course_feature_flags_course_id_flag_changed_at_idx" ON "course_feature_flags"("course_id", "flag", "changed_at");
