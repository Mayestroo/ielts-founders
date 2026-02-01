-- DropForeignKey
ALTER TABLE "WritingSubmission" DROP CONSTRAINT "WritingSubmission_sectionId_fkey";

-- DropForeignKey
ALTER TABLE "WritingSubmission" DROP CONSTRAINT "WritingSubmission_studentId_fkey";

-- AddForeignKey
ALTER TABLE "WritingSubmission" ADD CONSTRAINT "WritingSubmission_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WritingSubmission" ADD CONSTRAINT "WritingSubmission_sectionId_fkey" FOREIGN KEY ("sectionId") REFERENCES "ExamSection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
