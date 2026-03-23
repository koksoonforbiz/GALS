-- CreateTable
CREATE TABLE "spaced_repetition_cards" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "intervention_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "front" TEXT NOT NULL,
    "back" TEXT NOT NULL,
    "ease" DOUBLE PRECISION NOT NULL DEFAULT 2.5,
    "interval" INTEGER NOT NULL DEFAULT 0,
    "repetitions" INTEGER NOT NULL DEFAULT 0,
    "next_review_at" TIMESTAMPTZ NOT NULL,
    "last_reviewed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "spaced_repetition_cards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "spaced_repetition_cards_user_id_next_review_at_idx" ON "spaced_repetition_cards"("user_id", "next_review_at");

-- CreateIndex
CREATE INDEX "spaced_repetition_cards_course_id_idx" ON "spaced_repetition_cards"("course_id");

-- CreateIndex
CREATE INDEX "spaced_repetition_cards_intervention_id_idx" ON "spaced_repetition_cards"("intervention_id");

-- AddForeignKey
ALTER TABLE "spaced_repetition_cards" ADD CONSTRAINT "spaced_repetition_cards_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "spaced_repetition_cards" ADD CONSTRAINT "spaced_repetition_cards_intervention_id_fkey" FOREIGN KEY ("intervention_id") REFERENCES "learning_interventions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
