-- CreateEnum
CREATE TYPE "EnrollmentStatus" AS ENUM ('ACTIVE', 'DROPPED');

-- AlterTable
ALTER TABLE "enrollments" ADD COLUMN "status" "EnrollmentStatus" NOT NULL DEFAULT 'ACTIVE';
