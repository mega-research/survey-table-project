-- 2026-08-19 재생 가능성 수선: 수동 0009 와 journal 0010+ 의 적용 순서가 실제 이력에서
-- 교차해, 파일명 순 재생 시 이미 존재할 수 있다. 멱등으로 바꾼다.
ALTER TABLE "questions" ADD COLUMN IF NOT EXISTS "hide_column_labels" boolean DEFAULT false;
