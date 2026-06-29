ALTER TABLE questions
ADD COLUMN IF NOT EXISTS hide_title boolean DEFAULT false;
