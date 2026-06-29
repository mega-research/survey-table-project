ALTER TABLE surveys
ADD COLUMN IF NOT EXISTS response_header jsonb;
