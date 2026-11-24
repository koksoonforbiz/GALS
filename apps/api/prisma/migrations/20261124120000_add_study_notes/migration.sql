-- Study notes: a student's own highlights and notes on the course page
-- (Notes tab), plus their activity-log actions. Additive only.

ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'NOTE_CREATED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'NOTE_EDITED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'NOTE_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'HIGHLIGHT_CREATED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'HIGHLIGHT_DELETED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'NOTES_VIEWED';

-- CreateTable
CREATE TABLE "study_notes" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "module_item_id" UUID,
    "slide_key" TEXT,
    "location" TEXT NOT NULL DEFAULT '',
    "source" TEXT NOT NULL,
    "quote" TEXT,
    "prefix" TEXT,
    "suffix" TEXT,
    "color" TEXT,
    "body" TEXT NOT NULL DEFAULT '',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "study_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "study_notes_student_id_course_id_idx" ON "study_notes"("student_id", "course_id");

-- AddForeignKey
ALTER TABLE "study_notes" ADD CONSTRAINT "study_notes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_notes" ADD CONSTRAINT "study_notes_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "study_notes" ADD CONSTRAINT "study_notes_module_item_id_fkey" FOREIGN KEY ("module_item_id") REFERENCES "module_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
