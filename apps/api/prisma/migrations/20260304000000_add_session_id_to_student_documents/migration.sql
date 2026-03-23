-- AlterTable
ALTER TABLE "student_source_documents" ADD COLUMN "session_id" TEXT;

-- CreateIndex
CREATE INDEX "student_source_documents_session_id_idx" ON "student_source_documents"("session_id");

-- AddForeignKey
ALTER TABLE "student_source_documents" ADD CONSTRAINT "student_source_documents_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "dialogue_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
