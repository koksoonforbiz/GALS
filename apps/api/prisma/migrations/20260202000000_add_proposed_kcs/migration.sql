-- CreateEnum
CREATE TYPE "ProposedKCStatus" AS ENUM ('PROPOSED', 'APPROVED', 'ARCHIVED');

-- CreateTable
CREATE TABLE "proposed_kcs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProposedKCStatus" NOT NULL DEFAULT 'PROPOSED',
    "confidence_level" TEXT NOT NULL DEFAULT 'MEDIUM',
    "created_by" TEXT NOT NULL DEFAULT 'ai',
    "generation_job_id" UUID,
    "related_to_kc_id" UUID,
    "evidence" JSONB NOT NULL DEFAULT '[]',
    "page_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "proposed_kcs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "proposed_kcs_course_id_idx" ON "proposed_kcs"("course_id");
CREATE INDEX "proposed_kcs_status_idx" ON "proposed_kcs"("status");
CREATE INDEX "proposed_kcs_course_id_status_idx" ON "proposed_kcs"("course_id", "status");

-- AddForeignKey (self-relation for duplicate linking)
ALTER TABLE "proposed_kcs" ADD CONSTRAINT "proposed_kcs_related_to_kc_id_fkey"
    FOREIGN KEY ("related_to_kc_id") REFERENCES "proposed_kcs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
