ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_table_display_mode" text DEFAULT 'auto';

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_drilldown_omit_leading_columns" integer DEFAULT 1;

UPDATE "questions"
SET "mobile_table_display_mode" = 'original'
WHERE "mobile_original_table" = true;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'questions_mobile_table_display_mode_check'
  ) THEN
    ALTER TABLE "questions"
      ADD CONSTRAINT "questions_mobile_table_display_mode_check"
      CHECK ("mobile_table_display_mode" IN ('auto', 'drilldown-original-row', 'original'));
  END IF;
END $$;
