-- DropIndex
DROP INDEX "grading_results_attempt_id_key";

-- AlterTable
ALTER TABLE "attempts" ADD COLUMN     "assessment_id" UUID;

-- CreateIndex
CREATE INDEX "attempts_assessment_id_idx" ON "attempts"("assessment_id");

-- CreateIndex
CREATE INDEX "grading_results_attempt_id_idx" ON "grading_results"("attempt_id");
