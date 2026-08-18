-- 응답 내역(profiles) 표시 컬럼 픽커. NULL = 기본 스킴(기존 9컬럼 고정 세트).
-- progress_columns(0017)와 동일한 nullable jsonb 패턴 — 백필·인덱스 불필요.
ALTER TABLE "surveys" ADD COLUMN IF NOT EXISTS "profile_columns" jsonb;
