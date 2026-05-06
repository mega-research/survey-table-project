-- Migration: 0013_unique_survey_session
-- Purpose: (survey_id, session_id) UNIQUE 제약 추가 — createResponseWithFirstAnswer 의
--          SELECT-then-INSERT race condition 을 ON CONFLICT 패턴으로 닫기 위함.
-- Background:
--   동일 (surveyId, sessionId) 로 첫 답 INSERT 가 동시에 두 번 도달 시
--   기존 멱등성 SELECT 가 둘 다 0 rows 를 보고 양쪽이 INSERT → 응답 행 중복 생성.
--   PG 는 NULL 값을 UNIQUE 에서 distinct 로 취급해 session_id IS NULL 행이
--   여럿 있어도 허용된다 (의도).
--
-- Pre-flight (실행 전 prod 에서 반드시 확인):
--   SELECT survey_id, session_id, COUNT(*)
--   FROM survey_responses
--   WHERE session_id IS NOT NULL
--   GROUP BY 1, 2
--   HAVING COUNT(*) > 1;
--   → 결과가 비어 있어야 본 마이그레이션이 성공한다. 중복이 있으면 수동 정리 후 재시도.

BEGIN;

ALTER TABLE "survey_responses"
  ADD CONSTRAINT "survey_responses_survey_session_unique"
  UNIQUE ("survey_id", "session_id");

COMMIT;
