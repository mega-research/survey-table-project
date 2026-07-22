ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_drilldown_repeat_header_start_row" integer DEFAULT 0;

ALTER TABLE "questions"
  ADD COLUMN IF NOT EXISTS "mobile_drilldown_repeat_header_end_row" integer DEFAULT 0;

ALTER TABLE "questions"
  ALTER COLUMN "mobile_drilldown_repeat_header_start_row" SET DEFAULT 0;

ALTER TABLE "questions"
  ALTER COLUMN "mobile_drilldown_repeat_header_end_row" SET DEFAULT 0;

UPDATE "questions"
SET
  "mobile_drilldown_repeat_header_start_row" = NULL,
  "mobile_drilldown_repeat_header_end_row" = NULL
WHERE "hide_column_labels" IS TRUE;
