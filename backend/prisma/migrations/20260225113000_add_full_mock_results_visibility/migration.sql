-- AlterTable
ALTER TABLE "FullMockSession"
ADD COLUMN "resultsVisibleToStudent" BOOLEAN;

-- Preserve existing behavior for past sessions
UPDATE "FullMockSession"
SET "resultsVisibleToStudent" = true
WHERE "resultsVisibleToStudent" IS NULL;

-- New sessions default to hidden until released
ALTER TABLE "FullMockSession"
ALTER COLUMN "resultsVisibleToStudent" SET NOT NULL,
ALTER COLUMN "resultsVisibleToStudent" SET DEFAULT false;
