-- 0085: 보관기한 파기 대상에 이월 응답 추가
--
-- 0050 의 sweep_expired_pii 는 response_answers 와 survey_responses 만 훑는다.
-- 0084 의 contact_prior_answers 는 응답 저장 형태와 동형이라 PII 문항 값이 같은
-- 암호문('v1:...')으로 적재되는데, 파기 잡이 이 테이블을 보지 않아 보관기한이
-- 지나도 남는다. 함수 본문을 통째로 교체해 세 번째 블록을 더한다.
--
-- 판정 기준은 0050 과 동일하다: 접두사 단독(평문 잔존분은 의도적으로 대상 아님),
-- 마커는 'v_:%' 에 매치되지 않으므로 재실행 멱등. cron 잡은 함수를 호출하므로
-- 재스케줄이 필요 없다.

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
    AND jsonb_typeof(sr.question_responses) = 'object'
    AND EXISTS (
      SELECT 1
      FROM jsonb_each(sr.question_responses) AS e2(key, value)
      WHERE jsonb_typeof(e2.value) = 'string'
        AND (e2.value #>> '{}') ~ '^v[0-9]+:'
    );

  -- 3) 이월 응답(추적조사): 2) 와 같은 규칙을 contact_prior_answers.answers 에 적용.
  --    보관기한은 조사 대상이 속한 설문의 것을 따른다.
  UPDATE contact_prior_answers cpa
  SET answers = (
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
    FROM jsonb_each(cpa.answers) AS e(key, value)
  ),
  updated_at = now()
  FROM contact_targets ct
  JOIN surveys s ON s.id = ct.survey_id
  WHERE cpa.contact_target_id = ct.id
    AND s.pii_retention_until IS NOT NULL
    AND s.pii_retention_until < now()
    AND cpa.answers IS NOT NULL
    AND jsonb_typeof(cpa.answers) = 'object'
    AND EXISTS (
      SELECT 1
      FROM jsonb_each(cpa.answers) AS e2(key, value)
      WHERE jsonb_typeof(e2.value) = 'string'
        AND (e2.value #>> '{}') ~ '^v[0-9]+:'
    );
$$ LANGUAGE sql;
