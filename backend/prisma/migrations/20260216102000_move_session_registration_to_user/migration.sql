-- CreateEnum
CREATE TYPE "SessionReferralSource" AS ENUM ('TELEGRAM', 'INSTAGRAM', 'FACEBOOK', 'GOOGLE', 'FRIENDS', 'OTHER');

-- AlterTable
ALTER TABLE "User"
ADD COLUMN "sessionAttendanceMode" "SessionAttendanceMode" NOT NULL DEFAULT 'OFFLINE',
ADD COLUMN "sessionScheduledAt" TIMESTAMP(3),
ADD COLUMN "sessionReferralSource" "SessionReferralSource",
ADD COLUMN "phoneNumber" TEXT;

-- AlterTable
ALTER TABLE "FullMockSession"
DROP COLUMN "firstName",
DROP COLUMN "lastName",
DROP COLUMN "attendanceMode",
DROP COLUMN "scheduledAt",
DROP COLUMN "referralSource",
DROP COLUMN "phoneNumber";
