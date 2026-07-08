ALTER TABLE surveys
ADD COLUMN IF NOT EXISTS quota_config jsonb;
