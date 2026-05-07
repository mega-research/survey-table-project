-- Migration: 0017_add_progress_columns
-- Purpose: slice 4 (Report 탭) — 진척률 표 표시 컬럼 픽커
-- - surveys.progress_columns JSONB — ProgressColumnScheme (NULL = 4개 고정 컬럼만)
-- Note: GROUP BY (survey_id, group_value) 인덱스는 0014의 idx_contact_targets_group 재사용
--       (별도 인덱스 추가 시 중복 B-tree 발생 → write amplification)

BEGIN;

ALTER TABLE "surveys" ADD COLUMN "progress_columns" jsonb;

COMMENT ON COLUMN "surveys"."progress_columns" IS
  'ProgressColumnScheme — 진척률 표 (Report 탭) 표시 컬럼 픽커 결과. NULL=4개 고정 컬럼만.';

COMMIT;

-- ROLLBACK SQL (수동):
-- BEGIN;
-- ALTER TABLE surveys DROP COLUMN IF EXISTS progress_columns;
-- COMMIT;
