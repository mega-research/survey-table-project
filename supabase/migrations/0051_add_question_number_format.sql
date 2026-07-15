ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "number_format" jsonb;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "sum_constraints" jsonb;
