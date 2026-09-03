-- 0100: 파기 스윕 함수 본문 합본 — 표 input 셀(0085) + 이월 응답(0095). (2026-09-02)
--
-- 0085 와 0095 는 서로 다른 브랜치에서 각각 0050 의 sweep_expired_pii() 본문을 기준으로
-- CREATE OR REPLACE 했다. 0085 는 response_answers.object_value 와 question_responses 의
-- 한 단계 중첩 객체(표 답변, 셀 id → 값) 안의 암호문을 파기 대상에 넣었고, 0095 는
-- contact_prior_answers.answers 를 세 번째 파기 블록으로 더했다. 두 파일은 상대의 변경을
-- 모르므로 재생 순서상 나중 것이 이겨 다른 쪽 파기가 조용히 빠진다 (빈 DB 재생도, 이미
-- 한쪽만 적용된 DB 에 나머지를 적용하는 경우도 같다). 두 본문의 합집합으로 한 번 더 교체한다.
--
-- 판정 기준은 0050 과 동일하다: 접두사('^v[0-9]+:') 단독, 마커는 매치되지 않으므로 재실행
-- 멱등. 이월 응답은 응답 저장 형태와 동형이므로 표 답변 객체 안의 암호문에도 0085 와 같은
-- 한 단계 중첩 규칙을 적용한다. pg_cron 잡은 0050 그대로 함수명을 호출하므로 재스케줄 불필요.

BEGIN;

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

  -- 1b) 정규화 테이블: object_value(표 답변 등) 안의 string 암호문만 마커로 치환 (0085)
  UPDATE response_answers ra
  SET object_value = (
    SELECT COALESCE(
      jsonb_object_agg(
        c.key,
        CASE
          WHEN jsonb_typeof(c.value) = 'string'
           AND (c.value #>> '{}') ~ '^v[0-9]+:'
          THEN to_jsonb('[개인정보 파기됨]'::text)
          ELSE c.value
        END
      ),
      '{}'::jsonb
    )
    FROM jsonb_each(ra.object_value) AS c(key, value)
  )
  FROM survey_responses sr
  JOIN surveys s ON s.id = sr.survey_id
  WHERE ra.response_id = sr.id
    AND s.pii_retention_until IS NOT NULL
    AND s.pii_retention_until < now()
    AND ra.object_value IS NOT NULL
    AND jsonb_typeof(ra.object_value) = 'object'
    AND EXISTS (
      SELECT 1
      FROM jsonb_each(ra.object_value) AS c2(key, value)
      WHERE jsonb_typeof(c2.value) = 'string'
        AND (c2.value #>> '{}') ~ '^v[0-9]+:'
    );

  -- 2) JSONB SSOT: 최상위 string 암호문 + 한 단계 객체(표 답변) 안의 string 암호문을 마커로 치환 (0085)
  UPDATE survey_responses sr
  SET question_responses = (
    SELECT COALESCE(
      jsonb_object_agg(
        e.key,
        CASE
          WHEN jsonb_typeof(e.value) = 'string'
           AND (e.value #>> '{}') ~ '^v[0-9]+:'
          THEN to_jsonb('[개인정보 파기됨]'::text)
          WHEN jsonb_typeof(e.value) = 'object'
          THEN (
            SELECT COALESCE(
              jsonb_object_agg(
                c.key,
                CASE
                  WHEN jsonb_typeof(c.value) = 'string'
                   AND (c.value #>> '{}') ~ '^v[0-9]+:'
                  THEN to_jsonb('[개인정보 파기됨]'::text)
                  ELSE c.value
                END
              ),
              '{}'::jsonb
            )
            FROM jsonb_each(e.value) AS c(key, value)
          )
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
      WHERE (jsonb_typeof(e2.value) = 'string' AND (e2.value #>> '{}') ~ '^v[0-9]+:')
         OR (jsonb_typeof(e2.value) = 'object' AND EXISTS (
              SELECT 1
              FROM jsonb_each(e2.value) AS c2(key, value)
              WHERE jsonb_typeof(c2.value) = 'string'
                AND (c2.value #>> '{}') ~ '^v[0-9]+:'
            ))
    );

  -- 3) 이월 응답(추적조사): 2) 와 같은 규칙을 contact_prior_answers.answers 에 적용 (0095).
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
          WHEN jsonb_typeof(e.value) = 'object'
          THEN (
            SELECT COALESCE(
              jsonb_object_agg(
                c.key,
                CASE
                  WHEN jsonb_typeof(c.value) = 'string'
                   AND (c.value #>> '{}') ~ '^v[0-9]+:'
                  THEN to_jsonb('[개인정보 파기됨]'::text)
                  ELSE c.value
                END
              ),
              '{}'::jsonb
            )
            FROM jsonb_each(e.value) AS c(key, value)
          )
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
      WHERE (jsonb_typeof(e2.value) = 'string' AND (e2.value #>> '{}') ~ '^v[0-9]+:')
         OR (jsonb_typeof(e2.value) = 'object' AND EXISTS (
              SELECT 1
              FROM jsonb_each(e2.value) AS c2(key, value)
              WHERE jsonb_typeof(c2.value) = 'string'
                AND (c2.value #>> '{}') ~ '^v[0-9]+:'
            ))
    );
$$ LANGUAGE sql;

COMMIT;
