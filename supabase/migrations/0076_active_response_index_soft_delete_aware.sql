-- 0076: idx_active_response_per_contact 의 술어에 deleted_at IS NULL 추가. (2026-08-19)
--
-- 문제: survey_responses.contact_target_id 위에 partial unique 두 개가 서로 모순됐다.
--   idx_active_response_per_contact            0014  is_completed=false AND ctid IS NOT NULL
--   survey_responses_test_target_active_unique 0057  ... AND deleted_at IS NULL
-- 앞의 것은 soft delete 를 모른다. 그래서 관리자가 진행중 응답을 휴지통으로 보낸 뒤
-- 응답자가 초대 링크로 재진입하면, response.service 가 isNull(deletedAt) 로 기존 행을
-- 못 찾아 새 행을 INSERT 하고 이 인덱스가 23505 로 막는다. 앱의 "응답 초기화" 는 물리
-- 삭제라 이 경로를 타지 않지만, 휴지통 경로는 그대로 노출돼 있었다.
--
-- 안전성: 새 술어는 기존보다 좁다(삭제된 행이 인덱스에서 빠짐). 대상 행이 줄어들 뿐이라
-- 기존 데이터가 새 제약을 위반할 수 없다. 2026-08-19 프로덕션 실측 — 전체 948행, 인덱스
-- 대상 47행, 컨택당 최대 중복 1. 테이블이 작아 CONCURRENTLY 없이 트랜잭션 안에서 원자
-- 교체한다.

BEGIN;

DROP INDEX IF EXISTS idx_active_response_per_contact;

CREATE UNIQUE INDEX IF NOT EXISTS idx_active_response_per_contact
  ON survey_responses (contact_target_id)
  WHERE is_completed = false AND contact_target_id IS NOT NULL AND deleted_at IS NULL;

COMMIT;
