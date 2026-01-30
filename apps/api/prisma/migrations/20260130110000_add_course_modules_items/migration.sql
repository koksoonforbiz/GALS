-- CreateEnum
CREATE TYPE "CourseStatus" AS ENUM ('DRAFT', 'PUBLISHED');
CREATE TYPE "CourseVisibility" AS ENUM ('PUBLIC', 'PRIVATE');
CREATE TYPE "ModuleItemType" AS ENUM ('PAGE', 'PDF', 'LINK', 'ASSESSMENT');

-- AlterTable: Add new fields to courses
ALTER TABLE "courses" ADD COLUMN "status" "CourseStatus" NOT NULL DEFAULT 'DRAFT';
ALTER TABLE "courses" ADD COLUMN "visibility" "CourseVisibility" NOT NULL DEFAULT 'PRIVATE';
ALTER TABLE "courses" ADD COLUMN "banner_blob_key" TEXT;
ALTER TABLE "courses" ADD COLUMN "order_index" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "courses" ADD COLUMN "archived_at" TIMESTAMPTZ;

-- CreateTable: course_modules
CREATE TABLE "course_modules" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "course_modules_pkey" PRIMARY KEY ("id")
);

-- CreateTable: module_items
CREATE TABLE "module_items" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "module_id" UUID NOT NULL,
    "type" "ModuleItemType" NOT NULL,
    "title" TEXT NOT NULL,
    "order_index" INTEGER NOT NULL,
    "content_mdx" TEXT,
    "pdf_blob_key" TEXT,
    "pdf_filename" TEXT,
    "pdf_size" INTEGER,
    "url" TEXT,
    "assessment_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "module_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "course_modules_course_id_idx" ON "course_modules"("course_id");
CREATE INDEX "module_items_module_id_idx" ON "module_items"("module_id");

-- AddForeignKey
ALTER TABLE "course_modules" ADD CONSTRAINT "course_modules_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "module_items" ADD CONSTRAINT "module_items_module_id_fkey" FOREIGN KEY ("module_id") REFERENCES "course_modules"("id") ON DELETE CASCADE ON UPDATE CASCADE;
