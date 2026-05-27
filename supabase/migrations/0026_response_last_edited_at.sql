-- Migration: 0026_response_last_edited_at
-- Purpose: survey_responses 에 last_edited_at 컬럼 추가 + deleted_at 인덱스 추가.
--   - last_edited_at : 어드민이 응답을 수정한 시각. NULL = 미수정.
--     응답자 본인 흐름(completedAt, lastActivityAt)과 구분.
--   - idx_survey_responses_deleted_at : soft-delete 조회 성능용 복합 인덱스.
--
-- 주의: drizzle migrate 자동 실행 대상 아님 (_journal.json 미등록).
--       Supabase MCP apply_migration 으로 적용.

ALTER TABLE "survey_responses" ADD COLUMN IF NOT EXISTS "last_edited_at" timestamp with time zone;

CREATE INDEX IF NOT EXISTS "idx_survey_responses_deleted_at" ON "survey_responses" ("survey_id","deleted_at");
