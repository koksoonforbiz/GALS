-- AlterTable: Add topicId and subtopicId to proposed_kcs
ALTER TABLE "proposed_kcs" ADD COLUMN "topic_id" UUID;
ALTER TABLE "proposed_kcs" ADD COLUMN "subtopic_id" UUID;

-- CreateIndex
CREATE INDEX "proposed_kcs_topic_id_idx" ON "proposed_kcs"("topic_id");
CREATE INDEX "proposed_kcs_subtopic_id_idx" ON "proposed_kcs"("subtopic_id");

-- AddForeignKey
ALTER TABLE "proposed_kcs" ADD CONSTRAINT "proposed_kcs_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "proposed_kcs" ADD CONSTRAINT "proposed_kcs_subtopic_id_fkey" FOREIGN KEY ("subtopic_id") REFERENCES "course_modules"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "kc_graph_layouts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "layout_json" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kc_graph_layouts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kc_graph_layouts_course_id_key" ON "kc_graph_layouts"("course_id");
