-- EF assessment (docs/EF_battery_v2, battery v2.0) and generic course gates.
-- Additive only: new enum types, new enum values, new tables. No existing
-- table or column is changed. Deployable with `prisma migrate deploy`.

-- CreateEnum
CREATE TYPE "CourseGateKind" AS ENUM ('EF_QUESTIONNAIRE', 'EF_TESTS', 'KNOWLEDGE_TEST');

-- CreateEnum
CREATE TYPE "CourseGatePosition" AS ENUM ('BEFORE_MODULE', 'AFTER_MODULE');

-- CreateEnum
CREATE TYPE "EfaOccasionCode" AS ENUM ('T0', 'T1', 'T2');

-- CreateEnum
CREATE TYPE "EfaOccasionStatus" AS ENUM ('not_started', 'questionnaire_done', 'in_progress', 'completed', 'abandoned');

-- CreateEnum
CREATE TYPE "EfaTaskStatus" AS ENUM ('pending', 'in_progress', 'completed', 'interrupted', 'skipped');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'EF_OCCASION_STARTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'EF_OCCASION_COMPLETED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'EF_TASK_STARTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'EF_TASK_COMPLETED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'EF_TASK_INTERRUPTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'EF_QUESTIONNAIRE_SUBMITTED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'GATE_UNLOCKED';

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'GATE_OVERRIDE';
ALTER TYPE "SecurityEventType" ADD VALUE IF NOT EXISTS 'EF_TASK_RESET';

-- CreateTable
CREATE TABLE "course_gates" (
    "id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "kind" "CourseGateKind" NOT NULL,
    "occasion" TEXT,
    "position" "CourseGatePosition" NOT NULL,
    "module_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "course_gates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "student_gate_completions" (
    "id" UUID NOT NULL,
    "gate_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "completed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "override_by" UUID,
    "reason" TEXT,

    CONSTRAINT "student_gate_completions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_stimulus_sets" (
    "id" UUID NOT NULL,
    "battery_version" TEXT NOT NULL,
    "sha256" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "extras" JSONB NOT NULL,
    "extras_sha256" TEXT NOT NULL,
    "seeded_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efa_stimulus_sets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_allocation_slots" (
    "slot" INTEGER NOT NULL,
    "block" INTEGER NOT NULL,
    "order_code" TEXT NOT NULL,
    "t0" TEXT NOT NULL,
    "t1" TEXT NOT NULL,
    "t2" TEXT NOT NULL,
    "claimed_at" TIMESTAMPTZ,
    "claimed_student_id" UUID,
    "claimed_course_id" UUID,

    CONSTRAINT "efa_allocation_slots_pkey" PRIMARY KEY ("slot")
);

-- CreateTable
CREATE TABLE "efa_course_configs" (
    "course_id" UUID NOT NULL,
    "enabled_occasions" JSONB NOT NULL,
    "enabled_tasks" TEXT[] DEFAULT ARRAY['w1', 'w2', 'w3', 'w4', 'w5', 'w6', 'w7']::TEXT[],
    "show_diagnosis_item" BOOLEAN NOT NULL DEFAULT false,
    "adexi_at_t2" BOOLEAN NOT NULL DEFAULT false,
    "t2_min_minutes_after_previous" INTEGER NOT NULL DEFAULT 0,
    "updated_by" UUID,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "efa_course_configs_pkey" PRIMARY KEY ("course_id")
);

-- CreateTable
CREATE TABLE "efa_occasions" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "occasion" "EfaOccasionCode" NOT NULL,
    "status" "EfaOccasionStatus" NOT NULL DEFAULT 'not_started',
    "form" TEXT,
    "order_code" TEXT,
    "slot" INTEGER,
    "battery_version" TEXT NOT NULL,
    "stimuli_sha256" TEXT NOT NULL,
    "consent_version" TEXT,
    "consented_at" TIMESTAMPTZ,
    "device" JSONB,
    "fullscreen_accepted" BOOLEAN,
    "sensing_paused" BOOLEAN NOT NULL DEFAULT false,
    "gap_since_previous_activity_ms" BIGINT,
    "focus_lost_ms_total" BIGINT NOT NULL DEFAULT 0,
    "scoring_version" TEXT,
    "flags" JSONB,
    "started_at" TIMESTAMPTZ,
    "questionnaire_done_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "abandoned_at" TIMESTAMPTZ,
    "last_activity_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efa_occasions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_answers" (
    "id" UUID NOT NULL,
    "occasion_id" UUID NOT NULL,
    "item_code" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "answered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efa_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_task_runs" (
    "id" UUID NOT NULL,
    "occasion_id" UUID NOT NULL,
    "task_code" TEXT NOT NULL,
    "attempt_no" INTEGER NOT NULL DEFAULT 1,
    "status" "EfaTaskStatus" NOT NULL DEFAULT 'pending',
    "skip_reason" TEXT,
    "progress" JSONB,
    "flags" JSONB,
    "started_at" TIMESTAMPTZ,
    "completed_at" TIMESTAMPTZ,
    "reset_reason" TEXT,
    "reset_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efa_task_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_trials" (
    "id" UUID NOT NULL,
    "task_run_id" UUID NOT NULL,
    "phase" TEXT NOT NULL,
    "part" TEXT NOT NULL,
    "trial_index" INTEGER NOT NULL,
    "stimulus" JSONB NOT NULL,
    "response" JSONB,
    "onset_ms" DOUBLE PRECISION,
    "first_input_ms" DOUBLE PRECISION,
    "submit_ms" DOUBLE PRECISION,
    "shown_ms" JSONB,
    "corrections" INTEGER NOT NULL DEFAULT 0,
    "focus_lost_ms" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "interrupted" BOOLEAN NOT NULL DEFAULT false,
    "correct" BOOLEAN,
    "client_ts" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efa_trials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_task_scores" (
    "id" UUID NOT NULL,
    "task_run_id" UUID NOT NULL,
    "scoring_version" TEXT NOT NULL,
    "scores" JSONB NOT NULL,
    "flags" JSONB,
    "computed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efa_task_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_codes" (
    "id" UUID NOT NULL,
    "trial_id" UUID NOT NULL,
    "entry_index" INTEGER NOT NULL DEFAULT 0,
    "rater_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "category" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efa_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_final_codes" (
    "id" UUID NOT NULL,
    "trial_id" UUID NOT NULL,
    "entry_index" INTEGER NOT NULL DEFAULT 0,
    "code" TEXT NOT NULL,
    "category" TEXT,
    "source" TEXT NOT NULL,
    "adjudicated_by" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "efa_final_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "efa_rater_assignments" (
    "course_id" UUID NOT NULL,
    "task_code" TEXT NOT NULL,
    "rater_id" UUID NOT NULL,

    CONSTRAINT "efa_rater_assignments_pkey" PRIMARY KEY ("course_id","task_code","rater_id")
);

-- CreateIndex
CREATE INDEX "course_gates_course_id_idx" ON "course_gates"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "course_gates_course_id_kind_occasion_key" ON "course_gates"("course_id", "kind", "occasion");

-- CreateIndex
CREATE INDEX "student_gate_completions_student_id_idx" ON "student_gate_completions"("student_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_gate_completions_gate_id_student_id_key" ON "student_gate_completions"("gate_id", "student_id");

-- CreateIndex
CREATE UNIQUE INDEX "efa_stimulus_sets_sha256_key" ON "efa_stimulus_sets"("sha256");

-- CreateIndex
CREATE INDEX "efa_occasions_course_id_idx" ON "efa_occasions"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "efa_occasions_student_id_course_id_occasion_key" ON "efa_occasions"("student_id", "course_id", "occasion");

-- CreateIndex
CREATE UNIQUE INDEX "efa_answers_occasion_id_item_code_key" ON "efa_answers"("occasion_id", "item_code");

-- CreateIndex
CREATE UNIQUE INDEX "efa_task_runs_occasion_id_task_code_attempt_no_key" ON "efa_task_runs"("occasion_id", "task_code", "attempt_no");

-- CreateIndex
CREATE UNIQUE INDEX "efa_trials_task_run_id_phase_part_trial_index_key" ON "efa_trials"("task_run_id", "phase", "part", "trial_index");

-- CreateIndex
CREATE UNIQUE INDEX "efa_task_scores_task_run_id_scoring_version_key" ON "efa_task_scores"("task_run_id", "scoring_version");

-- CreateIndex
CREATE UNIQUE INDEX "efa_codes_trial_id_entry_index_rater_id_key" ON "efa_codes"("trial_id", "entry_index", "rater_id");

-- CreateIndex
CREATE UNIQUE INDEX "efa_final_codes_trial_id_entry_index_key" ON "efa_final_codes"("trial_id", "entry_index");

-- AddForeignKey
ALTER TABLE "student_gate_completions" ADD CONSTRAINT "student_gate_completions_gate_id_fkey" FOREIGN KEY ("gate_id") REFERENCES "course_gates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_gate_completions" ADD CONSTRAINT "student_gate_completions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efa_occasions" ADD CONSTRAINT "efa_occasions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efa_answers" ADD CONSTRAINT "efa_answers_occasion_id_fkey" FOREIGN KEY ("occasion_id") REFERENCES "efa_occasions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efa_task_runs" ADD CONSTRAINT "efa_task_runs_occasion_id_fkey" FOREIGN KEY ("occasion_id") REFERENCES "efa_occasions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efa_trials" ADD CONSTRAINT "efa_trials_task_run_id_fkey" FOREIGN KEY ("task_run_id") REFERENCES "efa_task_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efa_task_scores" ADD CONSTRAINT "efa_task_scores_task_run_id_fkey" FOREIGN KEY ("task_run_id") REFERENCES "efa_task_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efa_codes" ADD CONSTRAINT "efa_codes_trial_id_fkey" FOREIGN KEY ("trial_id") REFERENCES "efa_trials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "efa_final_codes" ADD CONSTRAINT "efa_final_codes_trial_id_fkey" FOREIGN KEY ("trial_id") REFERENCES "efa_trials"("id") ON DELETE CASCADE ON UPDATE CASCADE;

