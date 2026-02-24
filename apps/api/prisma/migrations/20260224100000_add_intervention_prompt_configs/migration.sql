-- CreateTable
CREATE TABLE "intervention_prompt_configs" (
    "id" TEXT NOT NULL,
    "course_id" UUID NOT NULL,
    "intervention_type" "InterventionType" NOT NULL,
    "teacher_id" UUID NOT NULL,
    "system_prompt" TEXT NOT NULL,
    "is_custom" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "intervention_prompt_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "intervention_prompt_configs_course_id_intervention_type_key" ON "intervention_prompt_configs"("course_id", "intervention_type");

-- AddForeignKey
ALTER TABLE "intervention_prompt_configs" ADD CONSTRAINT "intervention_prompt_configs_teacher_id_fkey" FOREIGN KEY ("teacher_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
