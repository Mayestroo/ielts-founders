-- CreateEnum
CREATE TYPE "SessionAttendanceMode" AS ENUM ('ONLINE', 'OFFLINE');

-- AlterTable
ALTER TABLE "FullMockSession"
ADD COLUMN "firstName" TEXT,
ADD COLUMN "lastName" TEXT,
ADD COLUMN "attendanceMode" "SessionAttendanceMode" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN "scheduledAt" TIMESTAMP(3),
ADD COLUMN "referralSource" TEXT,
ADD COLUMN "phoneNumber" TEXT;
