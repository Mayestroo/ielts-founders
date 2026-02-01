-- CreateEnum
CREATE TYPE "FullMockStatus" AS ENUM ('ASSIGNED', 'IN_PROGRESS', 'BREAK', 'COMPLETED');

-- AlterTable
ALTER TABLE "ExamAssignment" ADD COLUMN     "fullMockSequence" INTEGER,
ADD COLUMN     "fullMockSessionId" TEXT;

-- CreateTable
CREATE TABLE "FullMockSession" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "status" "FullMockStatus" NOT NULL DEFAULT 'ASSIGNED',
    "breakMinutes" INTEGER NOT NULL DEFAULT 2,
    "currentSequence" INTEGER NOT NULL DEFAULT 1,
    "breakEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FullMockSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FullMockSession_studentId_idx" ON "FullMockSession"("studentId");

-- CreateIndex
CREATE INDEX "FullMockSession_centerId_idx" ON "FullMockSession"("centerId");

-- CreateIndex
CREATE INDEX "FullMockSession_status_idx" ON "FullMockSession"("status");

-- CreateIndex
CREATE INDEX "ExamAssignment_fullMockSessionId_idx" ON "ExamAssignment"("fullMockSessionId");

-- CreateIndex
CREATE INDEX "ExamAssignment_fullMockSessionId_fullMockSequence_idx" ON "ExamAssignment"("fullMockSessionId", "fullMockSequence");

-- AddForeignKey
ALTER TABLE "ExamAssignment" ADD CONSTRAINT "ExamAssignment_fullMockSessionId_fkey" FOREIGN KEY ("fullMockSessionId") REFERENCES "FullMockSession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FullMockSession" ADD CONSTRAINT "FullMockSession_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FullMockSession" ADD CONSTRAINT "FullMockSession_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE CASCADE ON UPDATE CASCADE;
