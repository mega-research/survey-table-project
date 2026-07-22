ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_table_display_mode" text;

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_drilldown_omit_leading_columns" integer;

UPDATE "questions"
SET "mobile_table_display_mode" = CASE
  WHEN "mobile_original_table" = true THEN 'original'
  ELSE 'auto'
END
WHERE "mobile_table_display_mode" IS NULL;

UPDATE "questions"
SET "mobile_drilldown_omit_leading_columns" = 1
WHERE "mobile_drilldown_omit_leading_columns" IS NULL;

ALTER TABLE "questions"
  ALTER COLUMN "mobile_table_display_mode" SET DEFAULT 'auto';

ALTER TABLE "questions"
  ALTER COLUMN "mobile_drilldown_omit_leading_columns" SET DEFAULT 1;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'questions_mobile_table_display_mode_check'
      AND conrelid = 'public.questions'::regclass
  ) THEN
    ALTER TABLE "questions"
      ADD CONSTRAINT "questions_mobile_table_display_mode_check"
      CHECK ("mobile_table_display_mode" IN ('auto', 'drilldown-original-row', 'original'));
  END IF;
END $$;
