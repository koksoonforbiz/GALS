-- CreateTable
CREATE TABLE "kc_edges" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "from_kc_id" UUID NOT NULL,
    "to_kc_id" UUID NOT NULL,
    "relationship" TEXT NOT NULL DEFAULT 'prerequisite',
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,
    "created_by" TEXT NOT NULL DEFAULT 'ai',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "kc_edges_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kc_edges_from_kc_id_to_kc_id_key" ON "kc_edges"("from_kc_id", "to_kc_id");
CREATE INDEX "kc_edges_course_id_idx" ON "kc_edges"("course_id");

-- AddForeignKeys
ALTER TABLE "kc_edges" ADD CONSTRAINT "kc_edges_from_kc_id_fkey"
    FOREIGN KEY ("from_kc_id") REFERENCES "proposed_kcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "kc_edges" ADD CONSTRAINT "kc_edges_to_kc_id_fkey"
    FOREIGN KEY ("to_kc_id") REFERENCES "proposed_kcs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
