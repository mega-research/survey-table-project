ALTER TABLE question_groups
  ADD COLUMN IF NOT EXISTS name_design jsonb;
