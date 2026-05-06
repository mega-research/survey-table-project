-- Migration: 0015_contacts_polish
-- Purpose: 0014 폴리시 — search_path 하드닝 + 커버링 인덱스
--   I1: next_contact_resid 함수 search_path 하드닝 (Supabase advisor function_search_path_mutable 해소)
--   I2: idx_contact_attempts_target 에 INCLUDE (result_code) 추가 (listContactsForSurvey 의 최신 attempt
--       result_code 조회를 index-only scan 으로 전환)

BEGIN;

-- I1: next_contact_resid 함수 search_path 하드닝
--     - SET search_path = pg_catalog, public 으로 mutable search_path 차단
--     - public.contact_targets 로 명시 qualify
--     - 본문 로직(advisory lock + MAX(resid)+1) 은 0014 와 동일
CREATE OR REPLACE FUNCTION next_contact_resid(p_survey_id uuid) RETURNS integer AS $$
DECLARE
  next_id integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('contact_resid:' || p_survey_id::text));
  SELECT COALESCE(MAX(resid), 0) + 1 INTO next_id
    FROM public.contact_targets WHERE survey_id = p_survey_id;
  RETURN next_id;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog, public;

-- I2: idx_contact_attempts_target 커버링 인덱스 재생성
--     listContactsForSurvey (Task A4) 의 상관 서브쿼리:
--       SELECT result_code FROM contact_attempts
--         WHERE contact_target_id = X ORDER BY attempt_no DESC LIMIT 1
--     를 INCLUDE (result_code) 로 index-only scan 가능하게 만든다.
DROP INDEX IF EXISTS idx_contact_attempts_target;
CREATE INDEX idx_contact_attempts_target
  ON contact_attempts (contact_target_id, attempt_no DESC)
  INCLUDE (result_code);

COMMIT;

-- ROLLBACK SQL (수동 적용용 — 본 마이그레이션 실패 시):
-- 주의: 0014 까지 같이 롤백 시 본 0015 롤백을 먼저 실행한 뒤 0014 롤백.
-- 본 0015 롤백은 0014 가 적용된 상태를 가정 (idx_contact_attempts_target / next_contact_resid 존재).
-- BEGIN;
-- -- I2 롤백: INCLUDE 제거하고 0014 형태로 복원
-- DROP INDEX IF EXISTS idx_contact_attempts_target;
-- CREATE INDEX idx_contact_attempts_target
--   ON contact_attempts (contact_target_id, attempt_no DESC);
-- -- I1 롤백: search_path SET 절 제거하고 0014 형태로 복원
-- CREATE OR REPLACE FUNCTION next_contact_resid(p_survey_id uuid) RETURNS integer AS $$
-- DECLARE
--   next_id integer;
-- BEGIN
--   PERFORM pg_advisory_xact_lock(hashtext('contact_resid:' || p_survey_id::text));
--   SELECT COALESCE(MAX(resid), 0) + 1 INTO next_id
--     FROM contact_targets WHERE survey_id = p_survey_id;
--   RETURN next_id;
-- END;
-- $$ LANGUAGE plpgsql;
-- COMMIT;
