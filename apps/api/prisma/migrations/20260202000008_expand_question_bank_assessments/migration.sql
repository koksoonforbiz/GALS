-- Add new question types to enum
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'MCQ_SINGLE';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'MCQ_MULTI';
ALTER TYPE "QuestionType" ADD VALUE IF NOT EXISTS 'STRUCTURED';

-- Expand Question table
ALTER TABLE "questions" ADD COLUMN "course_id" UUID;
ALTER TABLE "questions" ADD COLUMN "stem" JSONB;
ALTER TABLE "questions" ADD COLUMN "options" JSONB;
ALTER TABLE "questions" ADD COLUMN "correct_option_id" TEXT;
ALTER TABLE "questions" ADD COLUMN "correct_answer" JSONB;
ALTER TABLE "questions" ADD COLUMN "explanation" JSONB;
ALTER TABLE "questions" ADD COLUMN "difficulty" INTEGER DEFAULT 3;
ALTER TABLE "questions" ADD COLUMN "blooms_level" TEXT;
ALTER TABLE "questions" ADD COLUMN "kc_ids" UUID[] DEFAULT '{}';
ALTER TABLE "questions" ADD COLUMN "page_ids" UUID[] DEFAULT '{}';
ALTER TABLE "questions" ADD COLUMN "tags" JSONB;
ALTER TABLE "questions" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'draft';
ALTER TABLE "questions" ADD COLUMN "created_by" TEXT;
ALTER TABLE "questions" ADD COLUMN "source_type" TEXT;
ALTER TABLE "questions" ADD COLUMN "provenance" JSONB;

-- Make topicId nullable (questions can now belong to course directly)
ALTER TABLE "questions" ALTER COLUMN "topic_id" DROP NOT NULL;

-- Add indexes for question bank
CREATE INDEX "questions_course_id_idx" ON "questions"("course_id");
CREATE INDEX "questions_status_idx" ON "questions"("status");
CREATE INDEX "questions_type_idx" ON "questions"("type");

-- Add foreign key for courseId
ALTER TABLE "questions" ADD CONSTRAINT "questions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Expand Assessment table
ALTER TABLE "assessments" ADD COLUMN "mode" TEXT NOT NULL DEFAULT 'practice';
ALTER TABLE "assessments" ADD COLUMN "settings" JSONB;

-- Expand AssessmentQuestion table
ALTER TABLE "assessment_questions" ADD COLUMN "points" DOUBLE PRECISION DEFAULT 1;
ALTER TABLE "assessment_questions" ADD COLUMN "section" TEXT;

-- Expand Attempt table
ALTER TABLE "attempts" ADD COLUMN "selected_option_ids" JSONB;
ALTER TABLE "attempts" ADD COLUMN "auto_feedback" TEXT;
