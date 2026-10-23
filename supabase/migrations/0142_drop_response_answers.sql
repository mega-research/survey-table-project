-- 0142: 문항별 응답 사본 response_answers 제거 + survey_responses 중복 인덱스 정리. (2026-10-23)
--
-- response_answers 는 survey_responses.question_responses 를 문항 하나 = 한 행으로 한 번 더 저장한
-- 사본이었다. 읽는 곳(분석 화면)은 모두 원본과 같은 JSONB 모양으로 되돌려 썼고, SQL 필터·집계에
-- 쓰는 곳이 없었다. 프로덕션 실측 79MB(인덱스 63MB), 완료 실응답 3,704건 대조 차이 0.
--
-- 배포 순서: 이 파일은 response_answers 를 읽지도 쓰지도 않는 앱이 배포된 **뒤에** 적용한다
-- (이 레포의 마이그레이션 선적용 관례와 반대). 먼저 적용하면 구버전 앱의 완료 제출이 실패한다.
--
-- 파기 스윕 함수를 사본 단계(0100 의 1·1b) 없이 먼저 교체하고 테이블을 지운다. SQL 함수 본문은
-- 실행 시점에 테이블을 찾으므로 순서가 바뀌면 다음 pg_cron 스윕이 실패한다. 나머지 본문은
-- 0100 그대로다(번호만 다시 매김). pg_cron 잡은 함수명을 호출하므로 재스케줄 불필요.
--
-- 인덱스: 프로덕션에만 있던(레포 마이그레이션에 없는) 중복 둘은 0038 의 부분 인덱스와 같은 일을
-- 한다 — 빈 DB 재생에는 없으므로 IF EXISTS. idx_survey_responses_completed(0004)는 사용 0회이고
-- idx_survey_responses_active_survey_completed 가 그 일을 한다.

BEGIN;

CREATE OR REPLACE FUNCTION sweep_expired_pii() RETURNS void AS $$
  -- 1) 응답 원본: 최상위 string 암호문 + 한 단계 객체(표 답변) 안의 string 암호문을 마커로 치환 (0085)
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

  -- 2) 이월 응답(추적조사): 1) 과 같은 규칙을 contact_prior_answers.answers 에 적용 (0095).
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

DROP TABLE IF EXISTS response_answers;

DROP INDEX IF EXISTS idx_responses_survey_device;
DROP INDEX IF EXISTS idx_responses_survey_fpip;
DROP INDEX IF EXISTS idx_survey_responses_completed;

COMMIT;
