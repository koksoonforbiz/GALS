-- CreateEnum
CREATE TYPE "ActivityAction" AS ENUM ('SESSION_START', 'SESSION_END', 'SESSION_HEARTBEAT', 'MODULE_OPENED', 'MODULE_ITEM_VIEWED', 'KC_GRAPH_VIEWED', 'ASSESSMENT_STARTED', 'QUESTION_VIEWED', 'QUESTION_ANSWERED', 'ASSESSMENT_SUBMITTED', 'ASSESSMENT_GRADED', 'DIALOGUE_SESSION_STARTED', 'DIALOGUE_MESSAGE_SENT', 'DIALOGUE_MESSAGE_RECEIVED', 'DIALOGUE_SESSION_ENDED', 'INTERVENTION_TRIGGERED', 'INTERVENTION_VIEWED', 'INTERVENTION_COMPLETED', 'INTERVENTION_DISMISSED', 'SPACED_REP_CARD_VIEWED', 'SPACED_REP_CARD_RATED', 'STUDY_MATERIAL_UPLOADED', 'STUDY_GUIDE_GENERATED', 'STUDIO_OUTPUT_REQUESTED', 'STUDIO_OUTPUT_VIEWED', 'MASTERY_UPDATED', 'FEEDBACK_RECEIVED');

-- CreateTable
CREATE TABLE "student_sessions" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "course_id" UUID,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMPTZ,
    "duration_secs" INTEGER,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "student_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "activity_logs" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" "ActivityAction" NOT NULL,
    "occurred_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "course_id" UUID,
    "module_id" UUID,
    "module_item_id" UUID,
    "assessment_id" UUID,
    "attempt_id" UUID,
    "question_id" UUID,
    "dialogue_session_id" UUID,
    "intervention_id" UUID,
    "kc_id" UUID,
    "metadata" JSONB,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "session_summaries" (
    "id" UUID NOT NULL,
    "session_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "total_events" INTEGER NOT NULL DEFAULT 0,
    "total_active_time_secs" INTEGER NOT NULL DEFAULT 0,
    "assessments_started" INTEGER NOT NULL DEFAULT 0,
    "assessments_submitted" INTEGER NOT NULL DEFAULT 0,
    "questions_answered" INTEGER NOT NULL DEFAULT 0,
    "questions_correct" INTEGER NOT NULL DEFAULT 0,
    "interventions_triggered" INTEGER NOT NULL DEFAULT 0,
    "interventions_completed" INTEGER NOT NULL DEFAULT 0,
    "intervention_breakdown" JSONB,
    "dialogue_sessions_started" INTEGER NOT NULL DEFAULT 0,
    "student_messages_sent" INTEGER NOT NULL DEFAULT 0,
    "flashcards_reviewed" INTEGER NOT NULL DEFAULT 0,
    "module_items_viewed" INTEGER NOT NULL DEFAULT 0,
    "study_materials_uploaded" INTEGER NOT NULL DEFAULT 0,
    "mastery_deltas" JSONB,
    "event_timeline" JSONB,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "session_summaries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_sessions_user_id_idx" ON "student_sessions"("user_id");

-- CreateIndex
CREATE INDEX "student_sessions_user_id_started_at_idx" ON "student_sessions"("user_id", "started_at");

-- CreateIndex
CREATE INDEX "activity_logs_session_id_idx" ON "activity_logs"("session_id");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_occurred_at_idx" ON "activity_logs"("user_id", "occurred_at");

-- CreateIndex
CREATE INDEX "activity_logs_user_id_action_idx" ON "activity_logs"("user_id", "action");

-- CreateIndex
CREATE INDEX "activity_logs_occurred_at_idx" ON "activity_logs"("occurred_at");

-- CreateIndex
CREATE UNIQUE INDEX "session_summaries_session_id_key" ON "session_summaries"("session_id");

-- CreateIndex
CREATE INDEX "session_summaries_user_id_idx" ON "session_summaries"("user_id");

-- AddForeignKey
ALTER TABLE "student_sessions" ADD CONSTRAINT "student_sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_sessions" ADD CONSTRAINT "student_sessions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "activity_logs" ADD CONSTRAINT "activity_logs_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_summaries" ADD CONSTRAINT "session_summaries_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "student_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "session_summaries" ADD CONSTRAINT "session_summaries_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
