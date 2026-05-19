-- CreateTable
CREATE TABLE "page_content_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "item_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "content_json" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "author_id" UUID,
    "job_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "page_content_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "page_content_versions_item_id_idx" ON "page_content_versions"("item_id");

-- CreateIndex
CREATE UNIQUE INDEX "page_content_versions_item_id_version_key" ON "page_content_versions"("item_id", "version");

-- AddForeignKey
ALTER TABLE "page_content_versions" ADD CONSTRAINT "page_content_versions_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "module_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
