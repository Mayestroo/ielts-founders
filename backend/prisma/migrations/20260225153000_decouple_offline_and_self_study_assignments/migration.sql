-- Drop unique constraint so offline and self-study assignments
-- can coexist for the same student and section.
ALTER TABLE "ExamAssignment"
DROP CONSTRAINT IF EXISTS "ExamAssignment_studentId_sectionId_key";

-- Keep one self-study assignment per student-section.
CREATE UNIQUE INDEX IF NOT EXISTS "ExamAssignment_student_section_self_study_unique"
ON "ExamAssignment" ("studentId", "sectionId")
WHERE "fullMockSessionId" IS NULL;

-- Keep one assignment per section inside the same offline session.
CREATE UNIQUE INDEX IF NOT EXISTS "ExamAssignment_offline_session_section_unique"
ON "ExamAssignment" ("fullMockSessionId", "sectionId")
WHERE "fullMockSessionId" IS NOT NULL;
