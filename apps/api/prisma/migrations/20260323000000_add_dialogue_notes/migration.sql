-- CreateTable
CREATE TABLE "dialogue_notes" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "source_document_id" TEXT,
    "page_number" INTEGER,
    "highlighted_text" TEXT,
    "note_text" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'yellow',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dialogue_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dialogue_notes_session_id_idx" ON "dialogue_notes"("session_id");

-- CreateIndex
CREATE INDEX "dialogue_notes_student_id_idx" ON "dialogue_notes"("student_id");

-- AddForeignKey
ALTER TABLE "dialogue_notes" ADD CONSTRAINT "dialogue_notes_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "dialogue_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_notes" ADD CONSTRAINT "dialogue_notes_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_notes" ADD CONSTRAINT "dialogue_notes_source_document_id_fkey" FOREIGN KEY ("source_document_id") REFERENCES "student_source_documents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
