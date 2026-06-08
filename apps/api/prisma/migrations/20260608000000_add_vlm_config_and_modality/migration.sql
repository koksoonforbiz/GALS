-- AddColumn modality to llm_usage_logs (default "text" for all existing rows)
ALTER TABLE "llm_usage_logs" ADD COLUMN "modality" TEXT NOT NULL DEFAULT 'text';

-- AddIndex on (user_id, modality) for cost split queries
CREATE INDEX "llm_usage_logs_user_id_modality_idx" ON "llm_usage_logs"("user_id", "modality");

-- CreateTable vlm_configs
CREATE TABLE "vlm_configs" (
    "id" TEXT NOT NULL,
    "teacher_id" UUID NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "text_threshold" INTEGER NOT NULL DEFAULT 80,
    "image_width" INTEGER NOT NULL DEFAULT 256,
    "image_height" INTEGER NOT NULL DEFAULT 256,
    "provider" TEXT NOT NULL DEFAULT 'same',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "vlm_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex unique on teacher_id
CREATE UNIQUE INDEX "vlm_configs_teacher_id_key" ON "vlm_configs"("teacher_id");

-- AddForeignKey
ALTER TABLE "vlm_configs" ADD CONSTRAINT "vlm_configs_teacher_id_fkey"
    FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
