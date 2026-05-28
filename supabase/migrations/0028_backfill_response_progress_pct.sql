-- Migration: 0028_backfill_response_progress_pct
-- Purpose: 기존 survey_responses 의 progress_pct 를 일괄 채운다.
--   - completed 응답은 100 으로.
--   - 그 외 (in_progress / drop / screened_out / quotaful_out / bad) 는
--     question_responses JSONB 키 → snapshot.questions 위치 매핑으로 max position 계산.
--   - response_answers 가 in_progress 흐름에서 채워지지 않으므로 question_responses 사용 (필수).
--   - snapshot 부재 / 모든 답이 legacy → NULL 유지 (UI 에서 '—' 표시 = fail-soft).
--
-- 주의: drizzle migrate 자동 실행 대상 아님 (_journal.json 미등록).
--       Supabase MCP apply_migration 으로 적용. 0027 이후 1회만 실행.

-- 1) completed 응답
UPDATE survey_responses
SET progress_pct = 100
WHERE status = 'completed' AND progress_pct IS NULL;

-- 2) 그 외 — question_responses JSONB 키 → snapshot position max
--    WITH ORDINALITY 는 PostgreSQL 에서 1-based 인덱스를 반환하므로 t.idx 가 곧 position.
WITH response_max AS (
  SELECT
    sr.id AS response_id,
    MAX(t.idx)::int AS max_pos,
    jsonb_array_length(
      CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
           THEN sv.snapshot->'questions'
           ELSE '[]'::jsonb
      END
    ) AS total_q
  FROM survey_responses sr
  JOIN survey_versions sv ON sv.id = sr.version_id
  CROSS JOIN LATERAL jsonb_array_elements(
    CASE WHEN jsonb_typeof(sv.snapshot->'questions') = 'array'
         THEN sv.snapshot->'questions'
         ELSE '[]'::jsonb
    END
  ) WITH ORDINALITY AS t(elem, idx)
  WHERE sr.progress_pct IS NULL
    AND sr.status <> 'completed'
    AND sr.deleted_at IS NULL
    AND sr.question_responses ? (elem->>'id')
  GROUP BY sr.id, sv.snapshot
)
UPDATE survey_responses sr
SET progress_pct = LEAST(100, GREATEST(0,
  ROUND((rm.max_pos::numeric / NULLIF(rm.total_q, 0)) * 100)::int
))::smallint
FROM response_max rm
WHERE sr.id = rm.response_id;
