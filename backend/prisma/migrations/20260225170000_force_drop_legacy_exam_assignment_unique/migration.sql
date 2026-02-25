-- Some environments may still have a legacy global unique key on
-- (studentId, sectionId), which blocks creating separate offline assignments.
-- Force-drop that legacy unique (constraint and/or index), then ensure
-- scoped partial uniques exist.

DO $$
DECLARE
  constraint_name text;
BEGIN
  FOR constraint_name IN
    SELECT con.conname
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE nsp.nspname = 'public'
      AND rel.relname = 'ExamAssignment'
      AND con.contype = 'u'
      AND pg_get_constraintdef(con.oid) LIKE 'UNIQUE ("studentId", "sectionId")%'
  LOOP
    EXECUTE format(
      'ALTER TABLE "ExamAssignment" DROP CONSTRAINT IF EXISTS %I',
      constraint_name
    );
  END LOOP;
END
$$;

DO $$
DECLARE
  index_name text;
BEGIN
  FOR index_name IN
    SELECT idx.indexname
    FROM pg_indexes idx
    WHERE idx.schemaname = 'public'
      AND idx.tablename = 'ExamAssignment'
      AND idx.indexdef LIKE 'CREATE UNIQUE INDEX%'
      AND idx.indexdef LIKE '%("studentId", "sectionId")%'
      AND idx.indexdef NOT LIKE '%WHERE%'
  LOOP
    EXECUTE format('DROP INDEX IF EXISTS %I', index_name);
  END LOOP;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS "ExamAssignment_student_section_self_study_unique"
ON "ExamAssignment" ("studentId", "sectionId")
WHERE "fullMockSessionId" IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "ExamAssignment_offline_session_section_unique"
ON "ExamAssignment" ("fullMockSessionId", "sectionId")
WHERE "fullMockSessionId" IS NOT NULL;
