-- Prompting-course Phase 6: intervention policies + nudge log (all disabled by
-- default), text-capture consent, Prompt Lab text retention flags. Additive only.

ALTER TABLE "prompt_lab_runs" ADD COLUMN     "retain_text" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "text_scrubbed_at" TIMESTAMPTZ;

CREATE TABLE "intervention_policies" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "requires_validated" BOOLEAN NOT NULL DEFAULT true,
    "message_template" TEXT NOT NULL,
    "rationale" TEXT NOT NULL,
    "max_per_activity" INTEGER NOT NULL DEFAULT 1,
    "cooldown_minutes" INTEGER NOT NULL DEFAULT 30,
    "ab_treatment_share" DOUBLE PRECISION,
    "updated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "intervention_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "rule_nudges" (
    "id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID,
    "module_item_id" UUID NOT NULL,
    "slide_key" TEXT,
    "rule_id" TEXT NOT NULL,
    "arm" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "trigger_detail" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responded_at" TIMESTAMPTZ,

    CONSTRAINT "rule_nudges_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "text_capture_consents" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "answer_text" BOOLEAN NOT NULL,
    "prompts_and_outputs" BOOLEAN NOT NULL,
    "research_use" BOOLEAN NOT NULL,
    "notice_version" TEXT NOT NULL,
    "decided_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "text_capture_consents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "intervention_policies_course_id_rule_id_key" ON "intervention_policies"("course_id", "rule_id");

CREATE INDEX "rule_nudges_student_id_module_item_id_rule_id_idx" ON "rule_nudges"("student_id", "module_item_id", "rule_id");

CREATE INDEX "rule_nudges_course_id_created_at_idx" ON "rule_nudges"("course_id", "created_at");

CREATE INDEX "text_capture_consents_student_id_course_id_decided_at_idx" ON "text_capture_consents"("student_id", "course_id", "decided_at");

ALTER TABLE "rule_nudges" ADD CONSTRAINT "rule_nudges_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "intervention_policies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "rule_nudges" ADD CONSTRAINT "rule_nudges_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "text_capture_consents" ADD CONSTRAINT "text_capture_consents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
