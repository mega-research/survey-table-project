-- Migration: 0027_add_response_progress_pct
-- Purpose: survey_responses 에 progress_pct (smallint nullable) 컬럼 추가.
--   - 응답 진행률 0~100 저장. completed=100, in_progress/drop/screened_out/quotaful_out/bad=계산값.
--   - 첫 답변 전 / snapshot 부재 / 모든 답이 legacy 인 응답은 NULL.
--   - CHECK 제약 의도적 생략 — write SQL 에서 LEAST(100, GREATEST(0, ...)) clamp 로 fail-soft.
--
-- 주의: drizzle migrate 자동 실행 대상 아님 (_journal.json 미등록).
--       Supabase MCP apply_migration 으로 적용.

ALTER TABLE "survey_responses" ADD COLUMN IF NOT EXISTS "progress_pct" smallint;

COMMENT ON COLUMN "survey_responses"."progress_pct" IS
  '응답 진행률 0~100. completed=100, in_progress/drop/screened_out/quotaful_out/bad=계산값, 첫 답변 전=NULL';
