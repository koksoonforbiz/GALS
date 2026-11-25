-- Announcements to students (additive only).
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT_VIEWED';
ALTER TYPE "ActivityAction" ADD VALUE IF NOT EXISTS 'ANNOUNCEMENT_ACKNOWLEDGED';

CREATE TABLE IF NOT EXISTS "announcements" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "course_id" UUID,
    "starts_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ends_at" TIMESTAMPTZ,
    "maintenance_start" TIMESTAMPTZ,
    "maintenance_end" TIMESTAMPTZ,
    "require_ack" BOOLEAN NOT NULL DEFAULT false,
    "created_by" UUID NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "archived_at" TIMESTAMPTZ,
    CONSTRAINT "announcements_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "announcements_starts_at_ends_at_idx" ON "announcements"("starts_at", "ends_at");

CREATE TABLE IF NOT EXISTS "announcement_acks" (
    "id" UUID NOT NULL,
    "announcement_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "ack_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "announcement_acks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "announcement_acks_announcement_id_user_id_key" ON "announcement_acks"("announcement_id", "user_id");
DO $$ BEGIN
  ALTER TABLE "announcement_acks" ADD CONSTRAINT "announcement_acks_announcement_id_fkey"
    FOREIGN KEY ("announcement_id") REFERENCES "announcements"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
