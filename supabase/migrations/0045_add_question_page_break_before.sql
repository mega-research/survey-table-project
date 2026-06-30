ALTER TABLE questions
ADD COLUMN IF NOT EXISTS page_break_before boolean DEFAULT false;
