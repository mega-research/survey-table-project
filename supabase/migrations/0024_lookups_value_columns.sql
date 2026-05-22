-- Migration: 0024_lookups_value_columns
-- Purpose: LUT 의 단일 value_column (text) 을 다중 value_columns (jsonb 배열) 로 전환.
--
-- 배경:
--   기존 모델은 LUT 마다 비교 결과로 노출할 값 컬럼이 1개 고정 → 같은 키 컬럼으로
--   여러 값 (예: "평균 항공요금" + "2026년 적용안") 을 비교에 쓰려면 LUT 를 N개 만들어야 함.
--   다중 값 컬럼을 허용하고, 비교 우변 에디터에서 어느 값 컬럼을 쓸지 선택하도록 변경.
--
-- 영향:
--   1. saved_lookups.value_column (text) → value_columns (jsonb)
--   2. surveys.lookups jsonb 배열 내 각 entry 도 valueColumn → valueColumns 로 변환
--   3. 신규 RightOperand.lookup.valueColumn 필드는 기존 데이터에 없음 (없으면 lookup-value-missing fail-safe SHOW)
--
-- 적용 순서 (사용자):
--   1. PR merge + 코드 배포
--   2. 이 SQL 파일 수동 적용 (supabase CLI 또는 MCP apply_migration)
--
-- 주의: 이 파일은 drizzle migrate 자동 실행 대상이 아님 (_journal.json 미등록).
--      saved_lookups 테이블이 아직 없는 경우 CREATE TABLE 부터 실행.

-- 1) saved_lookups 테이블이 없으면 다중 value_columns 구조로 생성
CREATE TABLE IF NOT EXISTS saved_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT NOT NULL,
  key_columns JSONB NOT NULL,
  value_columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_preset BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2) 이미 단일 value_column 으로 만들어진 환경 마이그레이션
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saved_lookups' AND column_name = 'value_column'
  ) THEN
    -- 새 컬럼 추가 (이미 1단계에서 생긴 경우 skip)
    ALTER TABLE saved_lookups
      ADD COLUMN IF NOT EXISTS value_columns JSONB NOT NULL DEFAULT '[]'::jsonb;

    -- value_column → value_columns = [value_column] 변환
    UPDATE saved_lookups
      SET value_columns = jsonb_build_array(value_column)
      WHERE value_column IS NOT NULL AND jsonb_array_length(value_columns) = 0;

    -- 옛 컬럼 제거
    ALTER TABLE saved_lookups DROP COLUMN value_column;
  END IF;
END $$;

-- 3) surveys.lookups jsonb 컬럼 보장 (없으면 추가)
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS lookups JSONB NOT NULL DEFAULT '[]'::jsonb;

-- 4) surveys.lookups 내 각 entry 의 valueColumn → valueColumns 변환
--    jsonb_array_elements 로 펼친 뒤, valueColumn 키가 있는 entry 만 변환.
UPDATE surveys
  SET lookups = (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          WHEN entry ? 'valueColumn' AND NOT (entry ? 'valueColumns')
            THEN (entry - 'valueColumn')
                 || jsonb_build_object('valueColumns', jsonb_build_array(entry->>'valueColumn'))
          ELSE entry
        END
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(lookups) AS entry
  )
  WHERE jsonb_typeof(lookups) = 'array' AND jsonb_array_length(lookups) > 0;
