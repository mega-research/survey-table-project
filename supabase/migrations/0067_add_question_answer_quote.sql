ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "answer_quote_enabled" boolean;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "answer_quote_name" text;
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "answer_quote_text" text;
