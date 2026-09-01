-- 0085: 파기 스윕이 표 input 셀 단위 암호문도 파기하도록 확장. (2026-09-01)
--
-- 0050 의 sweep_expired_pii() 는 question_responses 의 최상위 string 값만 봤다 (질문 단위 PII,
-- ADR-0012). 표 input 셀에 piiEncrypted 를 켜면 암호문이 표 답변 객체 안(셀 id → 값)과
-- response_answers.object_value 안에 놓이므로, 한 단계 중첩 객체의 string 값도 같은 접두사
-- 기준('^v[0-9]+:')으로 마커 치환한다. 배열·더 깊은 중첩은 손대지 않는다 (암호화 경로가 만들지
-- 않는 형상). 마커는 접두사에 매치되지 않으므로 재실행 멱등. pg_cron 잡은 0050 그대로 함수명을
-- 호출하므로 재스케줄 불필요.

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

  -- 1b) 정규화 테이블: object_value(표 답변 등) 안의 string 암호문만 마커로 치환
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

  -- 2) JSONB SSOT: 최상위 string 암호문 + 한 단계 객체(표 답변) 안의 string 암호문을 마커로 치환
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
$$ LANGUAGE sql;

COMMIT;
