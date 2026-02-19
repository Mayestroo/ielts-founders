-- ============================================================
-- PERFORMANCE MIGRATION: ExamResult composite index
-- Optimizes: calculateUserPoints aggregate query
-- Pattern: WHERE studentId = X AND bandScore IS NOT NULL
-- ============================================================

-- Before applying, verify current query plan:
-- EXPLAIN ANALYZE
-- SELECT AVG("bandScore")
-- FROM "ExamResult"
-- WHERE "studentId" = '<some-uuid>' AND "bandScore" IS NOT NULL;

-- Create composite index for covering index on the aggregate query
CREATE INDEX CONCURRENTLY IF NOT EXISTS "ExamResult_studentId_bandScore_idx"
  ON "ExamResult" ("studentId", "bandScore");

-- After applying, verify improved query plan:
-- EXPLAIN ANALYZE
-- SELECT AVG("bandScore")
-- FROM "ExamResult"
-- WHERE "studentId" = '<some-uuid>' AND "bandScore" IS NOT NULL;
-- Expected: Index Only Scan using ExamResult_studentId_bandScore_idx
