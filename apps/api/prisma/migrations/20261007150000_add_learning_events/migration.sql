-- Prompting-course learning-event parser (Phase 4). Additive only.

CREATE TABLE "learning_events" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "course_id" UUID,
    "module_item_id" UUID,
    "slide_key" TEXT,
    "rule_id" TEXT NOT NULL,
    "event_family" TEXT NOT NULL,
    "outcome" TEXT,
    "start_at" TIMESTAMPTZ NOT NULL,
    "end_at" TIMESTAMPTZ NOT NULL,
    "source_action_ids" UUID[],
    "confidence" TEXT NOT NULL DEFAULT 'candidate',
    "library_version" TEXT NOT NULL,
    "parameter_set_version" INTEGER NOT NULL,
    "detail" JSONB,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "learning_event_parameter_sets" (
    "version" INTEGER NOT NULL,
    "values" JSONB NOT NULL,
    "note" TEXT,
    "created_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_event_parameter_sets_pkey" PRIMARY KEY ("version")
);

CREATE INDEX "learning_events_session_id_idx" ON "learning_events"("session_id");

CREATE INDEX "learning_events_student_id_start_at_idx" ON "learning_events"("student_id", "start_at");

CREATE INDEX "learning_events_course_id_rule_id_idx" ON "learning_events"("course_id", "rule_id");

ALTER TABLE "learning_events" ADD CONSTRAINT "learning_events_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
