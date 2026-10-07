-- Prompting-course integration, Phase 1 (docs/process-mining/PHASE0_DISCOVERY.md).
-- Purely additive: one enum value, one nullable column, one new table.

-- AlterEnum
ALTER TYPE "ModuleItemType" ADD VALUE IF NOT EXISTS 'INTERACTIVE_LESSON';

-- AlterTable
ALTER TABLE "module_items" ADD COLUMN "lesson_json" JSONB;

-- CreateTable
CREATE TABLE "lesson_slide_states" (
    "id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "module_item_id" UUID NOT NULL,
    "slide_key" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "last_session_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "lesson_slide_states_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lesson_slide_states_module_item_id_idx" ON "lesson_slide_states"("module_item_id");

-- CreateIndex
CREATE UNIQUE INDEX "lesson_slide_states_student_id_module_item_id_slide_key_key" ON "lesson_slide_states"("student_id", "module_item_id", "slide_key");

-- AddForeignKey
ALTER TABLE "lesson_slide_states" ADD CONSTRAINT "lesson_slide_states_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lesson_slide_states" ADD CONSTRAINT "lesson_slide_states_module_item_id_fkey" FOREIGN KEY ("module_item_id") REFERENCES "module_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
