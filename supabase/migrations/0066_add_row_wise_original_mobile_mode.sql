SET LOCAL lock_timeout = '3s';

ALTER TABLE "questions"
  DROP CONSTRAINT IF EXISTS "questions_mobile_table_display_mode_check";

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_mobile_table_display_mode_check"
  CHECK (
    "mobile_table_display_mode"
    IN ('auto', 'drilldown-original-row', 'row-wise-original', 'original')
  );
