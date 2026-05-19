-- CreateTable
CREATE TABLE "knowledge_components" (
    "id" UUID NOT NULL,
    "topic_id" UUID NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "knowledge_components_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_kcs" (
    "id" UUID NOT NULL,
    "question_id" UUID NOT NULL,
    "kc_id" UUID NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 1.0,

    CONSTRAINT "question_kcs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kc_evidence" (
    "id" UUID NOT NULL,
    "grading_result_id" UUID NOT NULL,
    "kc_id" UUID NOT NULL,
    "is_correct" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kc_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mastery" (
    "id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "kc_id" UUID NOT NULL,
    "probability_known" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "total_attempts" INTEGER NOT NULL DEFAULT 0,
    "correct_attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ,
    "p_learn" DOUBLE PRECISION,
    "p_guess" DOUBLE PRECISION,
    "p_slip" DOUBLE PRECISION,
    "p_transit" DOUBLE PRECISION,

    CONSTRAINT "user_mastery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "knowledge_components_topic_id_idx" ON "knowledge_components"("topic_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_components_topic_id_code_key" ON "knowledge_components"("topic_id", "code");

-- CreateIndex
CREATE INDEX "question_kcs_question_id_idx" ON "question_kcs"("question_id");

-- CreateIndex
CREATE INDEX "question_kcs_kc_id_idx" ON "question_kcs"("kc_id");

-- CreateIndex
CREATE UNIQUE INDEX "question_kcs_question_id_kc_id_key" ON "question_kcs"("question_id", "kc_id");

-- CreateIndex
CREATE INDEX "kc_evidence_grading_result_id_idx" ON "kc_evidence"("grading_result_id");

-- CreateIndex
CREATE INDEX "kc_evidence_kc_id_idx" ON "kc_evidence"("kc_id");

-- CreateIndex
CREATE INDEX "user_mastery_user_id_idx" ON "user_mastery"("user_id");

-- CreateIndex
CREATE INDEX "user_mastery_kc_id_idx" ON "user_mastery"("kc_id");

-- CreateIndex
CREATE UNIQUE INDEX "user_mastery_user_id_kc_id_key" ON "user_mastery"("user_id", "kc_id");

-- AddForeignKey
ALTER TABLE "knowledge_components" ADD CONSTRAINT "knowledge_components_topic_id_fkey" FOREIGN KEY ("topic_id") REFERENCES "topics"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_kcs" ADD CONSTRAINT "question_kcs_question_id_fkey" FOREIGN KEY ("question_id") REFERENCES "questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "question_kcs" ADD CONSTRAINT "question_kcs_kc_id_fkey" FOREIGN KEY ("kc_id") REFERENCES "knowledge_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kc_evidence" ADD CONSTRAINT "kc_evidence_grading_result_id_fkey" FOREIGN KEY ("grading_result_id") REFERENCES "grading_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kc_evidence" ADD CONSTRAINT "kc_evidence_kc_id_fkey" FOREIGN KEY ("kc_id") REFERENCES "knowledge_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mastery" ADD CONSTRAINT "user_mastery_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mastery" ADD CONSTRAINT "user_mastery_kc_id_fkey" FOREIGN KEY ("kc_id") REFERENCES "knowledge_components"("id") ON DELETE CASCADE ON UPDATE CASCADE;
