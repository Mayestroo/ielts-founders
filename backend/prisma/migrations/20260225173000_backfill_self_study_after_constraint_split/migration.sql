-- After decoupling offline/self-study assignment constraints,
-- ensure each student has a standalone assignment for every center section.
INSERT INTO "ExamAssignment" (
  "id",
  "studentId",
  "sectionId",
  "status",
  "createdAt",
  "updatedAt"
)
SELECT
  md5(students."id" || ':' || sections."id" || ':self-study') AS "id",
  students."id" AS "studentId",
  sections."id" AS "sectionId",
  'ASSIGNED'::"AssignmentStatus" AS "status",
  NOW() AS "createdAt",
  NOW() AS "updatedAt"
FROM "User" students
JOIN "ExamSection" sections
  ON sections."centerId" = students."centerId"
 AND sections."type" IN (
   'LISTENING'::"ExamSectionType",
   'READING'::"ExamSectionType",
   'WRITING'::"ExamSectionType"
 )
LEFT JOIN "ExamAssignment" assignments
  ON assignments."studentId" = students."id"
 AND assignments."sectionId" = sections."id"
 AND assignments."fullMockSessionId" IS NULL
WHERE students."role" = 'STUDENT'::"Role"
  AND students."centerId" IS NOT NULL
  AND assignments."id" IS NULL;
