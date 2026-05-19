-- CreateTable
CREATE TABLE "knowledge_versions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "change_summary" TEXT NOT NULL,
    "change_type" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'human',
    "author_id" UUID,
    "snapshot_kcs" JSONB NOT NULL,
    "snapshot_edges" JSONB NOT NULL,
    "snapshot_maps" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),

    CONSTRAINT "knowledge_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_versions_course_id_version_key" ON "knowledge_versions"("course_id", "version");

-- CreateIndex
CREATE INDEX "knowledge_versions_course_id_idx" ON "knowledge_versions"("course_id");
