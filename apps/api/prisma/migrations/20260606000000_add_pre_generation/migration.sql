-- CreateTable
CREATE TABLE "pre_generation_configs" (
    "id" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'none',
    "number_of_sets" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    CONSTRAINT "pre_generation_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_generated_exercises" (
    "id" TEXT NOT NULL,
    "document_id" UUID NOT NULL,
    "page_number" INTEGER NOT NULL,
    "strategy" TEXT NOT NULL,
    "set_index" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "error_message" TEXT,
    "generated_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "pre_generated_exercises_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "pre_generation_configs_course_id_key" ON "pre_generation_configs"("course_id");

-- CreateIndex
CREATE UNIQUE INDEX "pre_generated_exercises_document_id_page_number_strategy_set_index_key" ON "pre_generated_exercises"("document_id", "page_number", "strategy", "set_index");

-- CreateIndex
CREATE INDEX "pre_generated_exercises_document_id_page_number_strategy_status_idx" ON "pre_generated_exercises"("document_id", "page_number", "strategy", "status");

-- AddForeignKey
ALTER TABLE "pre_generation_configs" ADD CONSTRAINT "pre_generation_configs_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_generated_exercises" ADD CONSTRAINT "pre_generated_exercises_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "source_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
