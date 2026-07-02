ALTER TABLE surveys
ADD COLUMN IF NOT EXISTS is_paused boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS paused_message text,
ADD COLUMN IF NOT EXISTS test_mode_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS test_token uuid;

ALTER TABLE survey_responses
ADD COLUMN IF NOT EXISTS is_test boolean NOT NULL DEFAULT false;
