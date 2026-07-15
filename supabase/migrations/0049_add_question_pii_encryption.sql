ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "pii_encrypted" boolean DEFAULT false NOT NULL;
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "pii_retention_until" timestamp with time zone;
