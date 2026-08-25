-- CreateEnum
CREATE TYPE "TwoFactorMethod" AS ENUM ('email', 'totp');

-- AlterTable: replace the on/off two_factor_enabled boolean with a
-- nullable method enum (null = off), and add the TOTP secret column.
ALTER TABLE "users" ADD COLUMN "two_factor_method" "TwoFactorMethod";
UPDATE "users" SET "two_factor_method" = 'email' WHERE "two_factor_enabled" = true;
ALTER TABLE "users" DROP COLUMN "two_factor_enabled";
ALTER TABLE "users" ADD COLUMN "totp_secret" TEXT;
