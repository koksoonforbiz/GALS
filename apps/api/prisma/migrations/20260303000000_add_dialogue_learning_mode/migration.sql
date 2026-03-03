-- Enable pgvector extension if available (required for vector column type)
-- Falls back to JSONB for embedding column if pgvector is not installed
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not available — embedding column will use JSONB fallback';
END $$;

-- CreateEnum: LearningMode
CREATE TYPE "LearningMode" AS ENUM ('STANDARD', 'DIALOGUE');

-- CreateEnum: StudentFileType
CREATE TYPE "StudentFileType" AS ENUM ('PDF', 'DOCX', 'DOC', 'TXT', 'MD', 'IMAGE_PNG', 'IMAGE_JPG', 'IMAGE_WEBP', 'CODE');

-- CreateEnum: DocumentProcessingStatus
CREATE TYPE "DocumentProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum: MessageRole
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM');

-- CreateEnum: StudioOutputType
CREATE TYPE "StudioOutputType" AS ENUM ('BRIEFING_DOC', 'FLASHCARD_SET', 'TABLE_COMPARISON', 'MIND_MAP', 'TIMELINE', 'FAQ');

-- AlterTable: Add learning mode fields to courses
ALTER TABLE "courses" ADD COLUMN "learning_mode" "LearningMode" NOT NULL DEFAULT 'STANDARD';
ALTER TABLE "courses" ADD COLUMN "dbl_settings" JSONB;

-- AlterTable: Add dialogue session link to learning_interventions
ALTER TABLE "learning_interventions" ADD COLUMN "dialogue_session_id" TEXT;

-- CreateTable: StudentSourceDocument
CREATE TABLE "student_source_documents" (
    "id" TEXT NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "file_name" TEXT NOT NULL,
    "original_name" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "blob_key" TEXT NOT NULL,
    "file_type" "StudentFileType" NOT NULL,
    "processing_status" "DocumentProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processing_error" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "student_source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: StudentSourceGuide
CREATE TABLE "student_source_guides" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "table_of_contents" JSONB NOT NULL,
    "suggested_questions" JSONB NOT NULL,
    "key_topics" JSONB NOT NULL,
    "generated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "student_source_guides_pkey" PRIMARY KEY ("id")
);

-- CreateTable: StudentRagChunk (embedding column type depends on pgvector availability)
CREATE TABLE "student_rag_chunks" (
    "id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "content" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "page_number" INTEGER,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "student_rag_chunks_pkey" PRIMARY KEY ("id")
);

-- Add embedding column: use vector(1536) if pgvector is available, otherwise JSONB
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'vector') THEN
    ALTER TABLE "student_rag_chunks" ADD COLUMN "embedding" vector(1536);
  ELSE
    ALTER TABLE "student_rag_chunks" ADD COLUMN "embedding" JSONB;
  END IF;
END $$;

-- CreateTable: DialogueSession
CREATE TABLE "dialogue_sessions" (
    "id" TEXT NOT NULL,
    "enrollment_id" UUID NOT NULL,
    "student_id" UUID NOT NULL,
    "course_id" UUID NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New Session',
    "active_source_ids" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "dialogue_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable: DialogueMessage
CREATE TABLE "dialogue_messages" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "citations" JSONB,
    "token_usage" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dialogue_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable: StudioOutput
CREATE TABLE "studio_outputs" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "student_id" UUID NOT NULL,
    "type" "StudioOutputType" NOT NULL,
    "title" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "source_ids" TEXT[],
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "studio_outputs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "student_source_documents_enrollment_id_idx" ON "student_source_documents"("enrollment_id");
CREATE INDEX "student_source_documents_student_id_course_id_idx" ON "student_source_documents"("student_id", "course_id");

-- CreateIndex
CREATE UNIQUE INDEX "student_source_guides_document_id_key" ON "student_source_guides"("document_id");

-- CreateIndex
CREATE INDEX "student_rag_chunks_document_id_idx" ON "student_rag_chunks"("document_id");
CREATE INDEX "student_rag_chunks_student_id_course_id_idx" ON "student_rag_chunks"("student_id", "course_id");

-- CreateIndex
CREATE INDEX "dialogue_sessions_enrollment_id_idx" ON "dialogue_sessions"("enrollment_id");
CREATE INDEX "dialogue_sessions_student_id_course_id_idx" ON "dialogue_sessions"("student_id", "course_id");

-- CreateIndex
CREATE INDEX "dialogue_messages_session_id_idx" ON "dialogue_messages"("session_id");

-- CreateIndex
CREATE INDEX "studio_outputs_session_id_idx" ON "studio_outputs"("session_id");
CREATE INDEX "studio_outputs_student_id_idx" ON "studio_outputs"("student_id");

-- AddForeignKey
ALTER TABLE "student_source_documents" ADD CONSTRAINT "student_source_documents_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "student_source_documents" ADD CONSTRAINT "student_source_documents_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "student_source_documents" ADD CONSTRAINT "student_source_documents_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_source_guides" ADD CONSTRAINT "student_source_guides_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "student_source_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "student_rag_chunks" ADD CONSTRAINT "student_rag_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "student_source_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_sessions" ADD CONSTRAINT "dialogue_sessions_enrollment_id_fkey" FOREIGN KEY ("enrollment_id") REFERENCES "enrollments"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "dialogue_sessions" ADD CONSTRAINT "dialogue_sessions_student_id_fkey" FOREIGN KEY ("student_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "dialogue_sessions" ADD CONSTRAINT "dialogue_sessions_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dialogue_messages" ADD CONSTRAINT "dialogue_messages_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "dialogue_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "studio_outputs" ADD CONSTRAINT "studio_outputs_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "dialogue_sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_interventions" ADD CONSTRAINT "learning_interventions_dialogue_session_id_fkey" FOREIGN KEY ("dialogue_session_id") REFERENCES "dialogue_sessions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
