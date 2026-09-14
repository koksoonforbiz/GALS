-- CreateEnum
CREATE TYPE "SecurityEventType" AS ENUM ('FAILED_LOGIN_UNKNOWN_IDENTIFIER', 'FAILED_LOGIN_INVALID_PASSWORD', 'FAILED_LOGIN_DEACTIVATED_ACCOUNT', 'FAILED_LOGIN_LOCKED_ACCOUNT', 'ACCOUNT_LOCKED_OUT', 'PERMISSION_DENIED', 'DEACTIVATED_TOKEN_REUSE');

-- CreateTable
CREATE TABLE "security_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "type" "SecurityEventType" NOT NULL,
    "user_id" UUID,
    "identifier" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "security_events_user_id_created_at_idx" ON "security_events"("user_id", "created_at");

-- CreateIndex
CREATE INDEX "security_events_type_created_at_idx" ON "security_events"("type", "created_at");

-- CreateIndex
CREATE INDEX "security_events_created_at_idx" ON "security_events"("created_at");

-- AddForeignKey
ALTER TABLE "security_events" ADD CONSTRAINT "security_events_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
