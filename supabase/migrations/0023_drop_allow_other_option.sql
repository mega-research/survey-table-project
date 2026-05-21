-- Migration: 0023_drop_allow_other_option
-- Purpose: questions.allow_other_option 컬럼 제거
--
-- 적용 전제: option-text-input 마이그레이션 스크립트(scripts/migrate-option-text.ts --apply)가 먼저 실행되어
--          모든 allowOtherOption=true 인 질문이 옵션 단위 allowTextInput 으로 변환된 상태여야 함.
--
-- 적용 순서 (사용자):
--   1. PR merge + 코드 배포
--   2. pnpm tsx scripts/migrate-option-text.ts --apply  (데이터 마이그레이션)
--   3. 이 SQL 파일 수동 적용 (supabase CLI 또는 mcp apply_migration)
--   4. 별도 cleanup PR — Drizzle schema / TS types 제거
--
-- 주의: 이 파일은 drizzle migrate 자동 실행 대상이 아님 (_journal.json 미등록).
--       supabase CLI 또는 MCP apply_migration 으로 수동 적용.

ALTER TABLE questions DROP COLUMN IF EXISTS allow_other_option;
