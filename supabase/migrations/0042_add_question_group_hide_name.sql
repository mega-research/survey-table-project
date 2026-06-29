ALTER TABLE question_groups
ADD COLUMN IF NOT EXISTS hide_name boolean DEFAULT false;
