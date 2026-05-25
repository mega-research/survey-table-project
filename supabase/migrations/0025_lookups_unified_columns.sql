-- Migration: 0025_lookups_unified_columns
-- Purpose: saved_lookups 와 surveys.lookups jsonb 를 단일 columns 구조로 통합.
--
-- 어떤 상태에서 호출되어도 멱등하게 동작하도록 작성:
--   A. 신규 환경 — saved_lookups 테이블이 아직 없음 → 새 구조로 생성
--   B. 원본 (e96d341 시점) — key_columns + value_column (text 단수형) 존재 → 흡수
--   C. 0024 적용 후 — key_columns + value_columns (jsonb 다중) 존재 → 흡수
--   D. 0025 이미 적용 — columns 만 존재 → no-op
--
-- 적용 (사용자):
--   Supabase MCP apply_migration 또는 supabase CLI 로 실행.
--
-- 주의: drizzle migrate 자동 실행 대상 아님 (_journal.json 미등록).

-- ─────────────────────────────────────────────────────────────────────────
-- A. saved_lookups 테이블이 없으면 새 구조로 생성
-- ─────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS saved_lookups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  description TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  category TEXT NOT NULL,
  columns JSONB NOT NULL DEFAULT '[]'::jsonb,
  rows JSONB NOT NULL DEFAULT '[]'::jsonb,
  usage_count INTEGER NOT NULL DEFAULT 0,
  is_preset BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- columns 컬럼 보장 (기존 테이블에 없으면 추가)
ALTER TABLE saved_lookups
  ADD COLUMN IF NOT EXISTS columns JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- B/C. 옛 컬럼 (key_columns, value_column, value_columns) 흡수 + drop
-- ─────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  has_key BOOLEAN;
  has_value_singular BOOLEAN;
  has_value_plural BOOLEAN;
  merge_expr TEXT;
BEGIN
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saved_lookups' AND column_name = 'key_columns'
  ) INTO has_key;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saved_lookups' AND column_name = 'value_column'
  ) INTO has_value_singular;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'saved_lookups' AND column_name = 'value_columns'
  ) INTO has_value_plural;

  -- 흡수할 옛 컬럼이 하나도 없으면 종료 (이미 마이그됨)
  IF NOT (has_key OR has_value_singular OR has_value_plural) THEN
    RETURN;
  END IF;

  -- columns 가 비어있는 행에 대해 옛 데이터를 합쳐서 채움
  IF has_key AND has_value_singular THEN
    merge_expr := 'COALESCE(key_columns, ''[]''::jsonb) || jsonb_build_array(value_column)';
  ELSIF has_key AND has_value_plural THEN
    merge_expr := 'COALESCE(key_columns, ''[]''::jsonb) || COALESCE(value_columns, ''[]''::jsonb)';
  ELSIF has_key THEN
    merge_expr := 'COALESCE(key_columns, ''[]''::jsonb)';
  ELSIF has_value_singular THEN
    merge_expr := 'jsonb_build_array(value_column)';
  ELSIF has_value_plural THEN
    merge_expr := 'COALESCE(value_columns, ''[]''::jsonb)';
  END IF;

  EXECUTE format(
    'UPDATE saved_lookups SET columns = %s WHERE jsonb_array_length(columns) = 0',
    merge_expr
  );

  -- 옛 컬럼 제거
  IF has_value_singular THEN
    EXECUTE 'ALTER TABLE saved_lookups DROP COLUMN value_column';
  END IF;
  IF has_value_plural THEN
    EXECUTE 'ALTER TABLE saved_lookups DROP COLUMN value_columns';
  END IF;
  IF has_key THEN
    EXECUTE 'ALTER TABLE saved_lookups DROP COLUMN key_columns';
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────
-- surveys.lookups jsonb 보장 (없으면 추가)
-- ─────────────────────────────────────────────────────────────────────────
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS lookups JSONB NOT NULL DEFAULT '[]'::jsonb;

-- ─────────────────────────────────────────────────────────────────────────
-- surveys.lookups jsonb 내부 entry 도 columns 단일 필드로 변환 (B/C → D)
-- ─────────────────────────────────────────────────────────────────────────
UPDATE surveys
  SET lookups = (
    SELECT COALESCE(
      jsonb_agg(
        CASE
          -- 이미 columns 만 있는 entry → 그대로
          WHEN (entry ? 'columns')
               AND NOT (entry ? 'keyColumns')
               AND NOT (entry ? 'valueColumn')
               AND NOT (entry ? 'valueColumns')
            THEN entry
          -- 변환: columns = keyColumns ++ (valueColumns | [valueColumn])
          ELSE (entry - 'keyColumns' - 'valueColumn' - 'valueColumns')
               || jsonb_build_object(
                    'columns',
                    COALESCE(entry->'keyColumns', '[]'::jsonb)
                    || COALESCE(
                         entry->'valueColumns',
                         CASE
                           WHEN entry ? 'valueColumn'
                             THEN jsonb_build_array(entry->>'valueColumn')
                           ELSE '[]'::jsonb
                         END
                       )
                  )
        END
      ),
      '[]'::jsonb
    )
    FROM jsonb_array_elements(lookups) AS entry
  )
  WHERE jsonb_typeof(lookups) = 'array' AND jsonb_array_length(lookups) > 0;
