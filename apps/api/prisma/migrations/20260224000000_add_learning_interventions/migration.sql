-- CreateEnum
CREATE TYPE "InterventionType" AS ENUM ('PRACTICE_TESTING', 'DISTRIBUTED_PRACTICE', 'STEPWISE_LEARNING', 'INTERROGATIVE_ELABORATION');

-- CreateEnum
CREATE TYPE "InterventionStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'ABANDONED');

-- CreateTable
CREATE TABLE "learning_interventions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "content_id" UUID,
    "page_type" TEXT,
    "type" "InterventionType" NOT NULL,
    "status" "InterventionStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "selected_text" TEXT NOT NULL,
    "session_data" JSONB,
    "completed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "learning_interventions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "saved_intervention_reviews" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "intervention_id" UUID NOT NULL,
    "intervention_type" "InterventionType" NOT NULL,
    "course_id" UUID NOT NULL,
    "content_id" UUID,
    "page_type" TEXT,
    "title" TEXT NOT NULL,
    "selected_text" TEXT NOT NULL,
    "saved_data" JSONB NOT NULL,
    "notes" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "saved_intervention_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_interventions_user_id_idx" ON "learning_interventions"("user_id");

-- CreateIndex
CREATE INDEX "learning_interventions_course_id_idx" ON "learning_interventions"("course_id");

-- CreateIndex
CREATE INDEX "saved_intervention_reviews_user_id_idx" ON "saved_intervention_reviews"("user_id");

-- CreateIndex
CREATE INDEX "saved_intervention_reviews_intervention_id_idx" ON "saved_intervention_reviews"("intervention_id");

-- CreateIndex
CREATE INDEX "saved_intervention_reviews_course_id_idx" ON "saved_intervention_reviews"("course_id");

-- AddForeignKey
ALTER TABLE "learning_interventions" ADD CONSTRAINT "learning_interventions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_intervention_reviews" ADD CONSTRAINT "saved_intervention_reviews_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "saved_intervention_reviews" ADD CONSTRAINT "saved_intervention_reviews_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "learning_interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
