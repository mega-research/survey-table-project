-- Migration: sweep_expired_pii
-- Purpose: 보관기한(pii_retention_until) 경과 설문의 암호화 응답값('v1:...' 접두사)을
--          '[개인정보 파기됨]' 마커로 치환하는 pg_cron 일일 잡 (ADR-0012).
--          접두사 단독 기준 — 토글 이전 평문 잔존분은 의도적으로 대상 아님 (스펙 6.2).
--          soft delete 된 설문(deleted_at IS NOT NULL)도 파기 대상에 포함한다.
--          마커는 'v_:%' 에 매치되지 않으므로 재실행 멱등.

CREATE EXTENSION IF NOT EXISTS pg_cron;

CREATE OR REPLACE FUNCTION sweep_expired_pii() RETURNS void AS $$
  -- 1) 정규화 테이블: text_value 가 암호문이면 마커로 치환
  UPDATE response_answers ra
  SET text_value = '[개인정보 파기됨]'
  FROM survey_responses sr
  JOIN surveys s ON s.id = sr.survey_id
  WHERE ra.response_id = sr.id
    AND s.pii_retention_until IS NOT NULL
    AND s.pii_retention_until < now()
    AND ra.text_value ~ '^v[0-9]+:';

  -- 2) JSONB SSOT: 최상위 string 값 중 암호문만 마커로 치환 (그 외 값 보존)
  UPDATE survey_responses sr
  SET question_responses = (
    SELECT COALESCE(
      jsonb_object_agg(
        e.key,
        CASE
          WHEN jsonb_typeof(e.value) = 'string'
           AND (e.value #>> '{}') ~ '^v[0-9]+:'
          THEN to_jsonb('[개인정보 파기됨]'::text)
          ELSE e.value
        END
      ),
      '{}'::jsonb
    )
    FROM jsonb_each(sr.question_responses) AS e(key, value)
  )
  FROM surveys s
  WHERE sr.survey_id = s.id
    AND s.pii_retention_until IS NOT NULL
    AND s.pii_retention_until < now()
    AND sr.question_responses IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM jsonb_each(sr.question_responses) AS e2(key, value)
      WHERE jsonb_typeof(e2.value) = 'string'
        AND (e2.value #>> '{}') ~ '^v[0-9]+:'
    );
$$ LANGUAGE sql;

-- 멱등 재스케줄 (0012 패턴): 기존 잡 unschedule 실패는 무시
DO $$
BEGIN
  PERFORM cron.unschedule('sweep-expired-pii');
EXCEPTION
  WHEN OTHERS THEN
    NULL;
END $$;

SELECT cron.schedule(
  'sweep-expired-pii',
  '0 19 * * *',                 -- 매일 19:00 UTC = KST 04:00
  $$SELECT sweep_expired_pii()$$
);

-- 수동 검증 (로컬 supabase 에서):
--   1. UPDATE surveys SET pii_retention_until = now() - interval '1 day' WHERE id = '<테스트 설문>';
--   2. SELECT sweep_expired_pii();
--   3. SELECT question_responses FROM survey_responses WHERE survey_id = '<테스트 설문>';
--      → 'v1:' 값이 '[개인정보 파기됨]' 으로, 평문/배열/객체는 그대로인지 확인
--   4. SELECT sweep_expired_pii();  -- 재실행 멱등 확인 (변경 0행)
