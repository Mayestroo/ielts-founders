-- CreateIndex
CREATE INDEX "ExamAssignment_studentId_createdAt_idx"
ON "ExamAssignment"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "ExamResult_studentId_submittedAt_idx"
ON "ExamResult"("studentId", "submittedAt");
