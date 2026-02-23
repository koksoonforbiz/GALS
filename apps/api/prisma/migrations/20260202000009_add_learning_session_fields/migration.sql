-- AlterTable
ALTER TABLE "stepwise_sessions" ADD COLUMN "summary" TEXT,
ADD COLUMN "total_steps" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "source_text" TEXT;

-- AlterTable
ALTER TABLE "elaboration_sessions" ADD COLUMN "source_text" TEXT;
