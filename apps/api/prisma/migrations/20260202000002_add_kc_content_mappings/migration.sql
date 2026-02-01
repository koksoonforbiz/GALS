-- CreateTable
CREATE TABLE "kc_content_mappings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "kc_id" UUID NOT NULL,
    "page_id" UUID NOT NULL,
    "strength" TEXT NOT NULL DEFAULT 'MEDIUM',
    "block_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by" TEXT NOT NULL DEFAULT 'ai',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kc_content_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kc_content_mappings_kc_id_page_id_key" ON "kc_content_mappings"("kc_id", "page_id");
CREATE INDEX "kc_content_mappings_course_id_idx" ON "kc_content_mappings"("course_id");
CREATE INDEX "kc_content_mappings_page_id_idx" ON "kc_content_mappings"("page_id");
CREATE INDEX "kc_content_mappings_kc_id_idx" ON "kc_content_mappings"("kc_id");

-- AddForeignKey
ALTER TABLE "kc_content_mappings" ADD CONSTRAINT "kc_content_mappings_kc_id_fkey"
    FOREIGN KEY ("kc_id") REFERENCES "proposed_kcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
