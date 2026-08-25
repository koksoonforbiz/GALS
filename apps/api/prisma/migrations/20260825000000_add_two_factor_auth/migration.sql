-- AlterTable: Add email-OTP two-factor auth fields to users
ALTER TABLE "users" ADD COLUMN "two_factor_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "two_factor_enabled_at" TIMESTAMPTZ;
