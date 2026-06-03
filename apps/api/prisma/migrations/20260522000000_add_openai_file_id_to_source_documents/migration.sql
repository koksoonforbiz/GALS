-- Add columns to cache the OpenAI Files API id for each uploaded source PDF.
-- Lets the page-content generator reference the file by id (small payload,
-- already-processed on OpenAI's side) instead of re-uploading the PDF bytes
-- on every generation call.

ALTER TABLE "source_documents"
  ADD COLUMN "openai_file_id" TEXT,
  ADD COLUMN "openai_file_uploaded_at" TIMESTAMPTZ;
