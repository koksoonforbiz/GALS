-- CreateEnum
CREATE TYPE "KnowledgeTestKind" AS ENUM ('PRE_STUDY', 'POST_STUDY', 'PRE_SESSION', 'POST_SESSION');

-- CreateEnum
CREATE TYPE "KnowledgeTestForm" AS ENUM ('A', 'B', 'C');

-- CreateEnum
CREATE TYPE "KnowledgeTestAttemptStatus" AS ENUM ('IN_PROGRESS', 'SUBMITTED', 'SCORED');

-- CreateEnum
CREATE TYPE "KnowledgeTestRaterRole" AS ENUM ('RATER', 'ADJUDICATOR');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE 'KNOWLEDGE_TEST_OPENED';
ALTER TYPE "ActivityAction" ADD VALUE 'KNOWLEDGE_TEST_ITEM_VIEWED';
ALTER TYPE "ActivityAction" ADD VALUE 'KNOWLEDGE_TEST_ITEM_ANSWERED';
ALTER TYPE "ActivityAction" ADD VALUE 'KNOWLEDGE_TEST_ITEM_SKIPPED';
ALTER TYPE "ActivityAction" ADD VALUE 'KNOWLEDGE_TEST_SUBMITTED';
ALTER TYPE "ActivityAction" ADD VALUE 'KNOWLEDGE_TEST_GATE_BLOCKED';

-- CreateTable
CREATE TABLE "knowledge_test_definitions" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "scope" TEXT NOT NULL,
    "session_no" INTEGER NOT NULL DEFAULT 0,
    "form" "KnowledgeTestForm" NOT NULL,
    "version" TEXT NOT NULL,
    "title" TEXT,
    "items" JSONB NOT NULL,
    "max_marks" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_test_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_test_assignments" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "kind" "KnowledgeTestKind" NOT NULL,
    "session_no" INTEGER NOT NULL DEFAULT 0,
    "form" "KnowledgeTestForm" NOT NULL,
    "order" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_test_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_test_attempts" (
    "id" UUID NOT NULL,
    "assignment_id" UUID NOT NULL,
    "definition_id" UUID NOT NULL,
    "student_session_id" UUID,
    "started_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMPTZ,
    "duration_ms" INTEGER,
    "responses" JSONB NOT NULL DEFAULT '{}',
    "last_saved_at" TIMESTAMPTZ,
    "autosave_only" BOOLEAN NOT NULL DEFAULT false,
    "auto_score" JSONB,
    "status" "KnowledgeTestAttemptStatus" NOT NULL DEFAULT 'IN_PROGRESS',

    CONSTRAINT "knowledge_test_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_test_written_scores" (
    "id" UUID NOT NULL,
    "attempt_id" UUID NOT NULL,
    "slot" INTEGER NOT NULL,
    "rater_id" UUID NOT NULL,
    "role" "KnowledgeTestRaterRole" NOT NULL DEFAULT 'RATER',
    "dimension_scores" JSONB NOT NULL,
    "total" INTEGER NOT NULL,
    "blinded_at" TIMESTAMPTZ NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_test_written_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_test_definitions_course_id_idx" ON "knowledge_test_definitions"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_test_definitions_course_id_scope_session_no_form__key" ON "knowledge_test_definitions"("course_id", "scope", "session_no", "form", "version");

-- CreateIndex
CREATE INDEX "knowledge_test_assignments_student_id_kind_session_no_idx" ON "knowledge_test_assignments"("student_id", "kind", "session_no");

-- CreateIndex
CREATE INDEX "knowledge_test_assignments_course_id_idx" ON "knowledge_test_assignments"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_test_assignments_student_id_course_id_kind_sessio_key" ON "knowledge_test_assignments"("student_id", "course_id", "kind", "session_no");

-- CreateIndex
CREATE INDEX "knowledge_test_attempts_assignment_id_idx" ON "knowledge_test_attempts"("assignment_id");

-- CreateIndex
CREATE INDEX "knowledge_test_attempts_definition_id_idx" ON "knowledge_test_attempts"("definition_id");

-- CreateIndex
CREATE INDEX "knowledge_test_written_scores_attempt_id_idx" ON "knowledge_test_written_scores"("attempt_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_test_written_scores_attempt_id_slot_rater_id_key" ON "knowledge_test_written_scores"("attempt_id", "slot", "rater_id");

-- AddForeignKey
ALTER TABLE "knowledge_test_assignments" ADD CONSTRAINT "knowledge_test_assignments_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_test_attempts" ADD CONSTRAINT "knowledge_test_attempts_assignment_id_fkey" FOREIGN KEY ("assignment_id") REFERENCES "knowledge_test_assignments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_test_attempts" ADD CONSTRAINT "knowledge_test_attempts_definition_id_fkey" FOREIGN KEY ("definition_id") REFERENCES "knowledge_test_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_test_attempts" ADD CONSTRAINT "knowledge_test_attempts_student_session_id_fkey" FOREIGN KEY ("student_session_id") REFERENCES "student_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_test_written_scores" ADD CONSTRAINT "knowledge_test_written_scores_attempt_id_fkey" FOREIGN KEY ("attempt_id") REFERENCES "knowledge_test_attempts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

