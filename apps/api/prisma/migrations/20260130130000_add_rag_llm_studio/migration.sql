-- CreateEnum
CREATE TYPE "DraftStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');
CREATE TYPE "ChunkingStrategy" AS ENUM ('FIXED_SIZE', 'PARAGRAPH', 'SEMANTIC');

-- CreateTable: source_documents
CREATE TABLE "source_documents" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "uploaded_by_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "blob_key" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "page_count" INTEGER,
    "chunking_strategy" "ChunkingStrategy" NOT NULL DEFAULT 'PARAGRAPH',
    "chunk_count" INTEGER NOT NULL DEFAULT 0,
    "indexed_at" TIMESTAMPTZ,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "source_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable: document_chunks
CREATE TABLE "document_chunks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "document_id" UUID NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "page_number" INTEGER,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "embedding" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable: content_drafts
CREATE TABLE "content_drafts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "course_id" UUID NOT NULL,
    "created_by_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "content_mdx" TEXT NOT NULL,
    "citations" JSONB,
    "status" "DraftStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewed_at" TIMESTAMPTZ,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parent_draft_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "content_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateTable: llm_audit_logs
CREATE TABLE "llm_audit_logs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "draft_id" UUID,
    "course_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "input_payload" JSONB,
    "output_payload" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "llm_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "source_documents_course_id_idx" ON "source_documents"("course_id");
CREATE INDEX "document_chunks_document_id_idx" ON "document_chunks"("document_id");
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks"("document_id", "chunk_index");
CREATE INDEX "content_drafts_course_id_idx" ON "content_drafts"("course_id");
CREATE INDEX "content_drafts_created_by_id_idx" ON "content_drafts"("created_by_id");
CREATE INDEX "llm_audit_logs_course_id_idx" ON "llm_audit_logs"("course_id");
CREATE INDEX "llm_audit_logs_user_id_idx" ON "llm_audit_logs"("user_id");
CREATE INDEX "llm_audit_logs_draft_id_idx" ON "llm_audit_logs"("draft_id");

-- AddForeignKey
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "source_documents" ADD CONSTRAINT "source_documents_uploaded_by_id_fkey" FOREIGN KEY ("uploaded_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "source_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_course_id_fkey" FOREIGN KEY ("course_id") REFERENCES "courses"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "content_drafts" ADD CONSTRAINT "content_drafts_created_by_id_fkey" FOREIGN KEY ("created_by_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "llm_audit_logs" ADD CONSTRAINT "llm_audit_logs_draft_id_fkey" FOREIGN KEY ("draft_id") REFERENCES "content_drafts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
