-- 0143: 문항별 응답 사본 response_answers 제거 + survey_responses 중복 인덱스 정리
--       + 옛 관리자 수정 백업(metadata.adminEditRollback)을 이관 이력(0142)으로 옮기고 지운다. (2026-10-23)
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
--
-- adminEditRollback: 관리자 수정 이관이 첫 이관 직전 답 한 벌을 metadata 에 남기던 백업이다. 읽는
-- 코드가 없었고, 파기 스윕이 metadata 를 보지 않아 보관기한이 지난 암호문이 남아 있었다(프로덕션 47행 중
-- 16행). 실응답의 백업은 이관 이력 한 줄(actor='admin', 옮겨 간 버전·옮긴 뒤 답은 모름 → NULL,
-- 시각은 백업의 savedAt)로 옮기고 암호문은 표식으로 바꾼다 — 앱의 withoutEncryptedAnswers 와 같은
-- 깊이(최상위 값 + 표 칸). 테스트 응답 백업은 옮기지 않고 지우기만 한다. 키를 지우는 문장이 같은
-- 트랜잭션이라 다시 실행해도 중복이 생기지 않는다. 배포 뒤에 두는 이유: 배포 전에 옮기면 구버전 앱이
-- 그 사이 새 백업을 쓴다.

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

INSERT INTO public.response_migration_history
  (response_id, survey_id, from_version_id, to_version_id, answers_before, answers_after, actor, created_at)
SELECT
  r.id,
  r.survey_id,
  (SELECT v.id FROM public.survey_versions v
     WHERE v.id::text = r.metadata->'adminEditRollback'->>'versionId'),
  NULL,
  (
    SELECT COALESCE(
      jsonb_object_agg(
        e.key,
        CASE
          WHEN jsonb_typeof(e.value) = 'string'
           AND (e.value #>> '{}') ~ '^v[0-9]+:'
          THEN to_jsonb('[개인정보 — 이력에 담지 않음]'::text)
          WHEN jsonb_typeof(e.value) = 'object'
          THEN (
            SELECT COALESCE(
              jsonb_object_agg(
                c.key,
                CASE
                  WHEN jsonb_typeof(c.value) = 'string'
                   AND (c.value #>> '{}') ~ '^v[0-9]+:'
                  THEN to_jsonb('[개인정보 — 이력에 담지 않음]'::text)
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
    FROM jsonb_each(r.metadata->'adminEditRollback'->'questionResponses') AS e(key, value)
  ),
  NULL,
  'admin',
  CASE
    WHEN (r.metadata->'adminEditRollback'->>'savedAt') ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T'
    THEN (r.metadata->'adminEditRollback'->>'savedAt')::timestamptz
    ELSE now()
  END
FROM public.survey_responses r
WHERE r.is_test = false
  AND r.metadata ? 'adminEditRollback'
  AND jsonb_typeof(r.metadata->'adminEditRollback'->'questionResponses') = 'object';

UPDATE public.survey_responses
SET metadata = metadata - 'adminEditRollback'
WHERE metadata ? 'adminEditRollback';

COMMIT;
