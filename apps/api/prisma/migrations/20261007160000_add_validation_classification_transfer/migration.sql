-- Prompting-course Phase 5: rule status log, prompt classification + human
-- labels, transfer-task scores, TRANSFER_TASK_SUBMITTED. Additive only.

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'TRANSFER_TASK_SUBMITTED';

CREATE TABLE "learning_event_rule_status_changes" (
    "id" UUID NOT NULL,
    "rule_id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "note" TEXT,
    "evidence" JSONB,
    "changed_by" UUID NOT NULL,
    "changed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_event_rule_status_changes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_classifications" (
    "id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID,
    "occurred_at" TIMESTAMPTZ NOT NULL,
    "label" TEXT NOT NULL,
    "classifier_version" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_classifications_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ai_prompt_human_labels" (
    "id" UUID NOT NULL,
    "source_type" TEXT NOT NULL,
    "source_id" UUID NOT NULL,
    "coder_id" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_prompt_human_labels_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "transfer_task_scores" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "module_item_id" UUID NOT NULL,
    "slide_key" TEXT NOT NULL,
    "scorer_id" UUID NOT NULL,
    "scores" JSONB NOT NULL,
    "total" DOUBLE PRECISION NOT NULL,
    "max_total" DOUBLE PRECISION NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "transfer_task_scores_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "learning_event_rule_status_changes_rule_id_changed_at_idx" ON "learning_event_rule_status_changes"("rule_id", "changed_at");

CREATE INDEX "ai_prompt_classifications_student_id_occurred_at_idx" ON "ai_prompt_classifications"("student_id", "occurred_at");

CREATE INDEX "ai_prompt_classifications_course_id_idx" ON "ai_prompt_classifications"("course_id");

CREATE UNIQUE INDEX "ai_prompt_classifications_source_type_source_id_classifier__key" ON "ai_prompt_classifications"("source_type", "source_id", "classifier_version");

CREATE UNIQUE INDEX "ai_prompt_human_labels_source_type_source_id_coder_id_key" ON "ai_prompt_human_labels"("source_type", "source_id", "coder_id");

CREATE UNIQUE INDEX "transfer_task_scores_student_id_module_item_id_slide_key_sc_key" ON "transfer_task_scores"("student_id", "module_item_id", "slide_key", "scorer_id");
