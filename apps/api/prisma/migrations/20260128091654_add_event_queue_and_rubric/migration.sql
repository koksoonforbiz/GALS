-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('pending', 'processing', 'processed', 'failed');

-- AlterTable
ALTER TABLE "questions" ADD COLUMN     "rubric_json" JSONB;

-- CreateTable
CREATE TABLE "event_queue" (
    "id" UUID NOT NULL,
    "topic" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "EventStatus" NOT NULL DEFAULT 'pending',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMPTZ,

    CONSTRAINT "event_queue_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "event_queue_topic_status_idx" ON "event_queue"("topic", "status");
