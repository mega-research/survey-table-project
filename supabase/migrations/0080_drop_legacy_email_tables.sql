-- 0080: 레거시 email_* 테이블·enum·함수 제거. (2026-08-19)
--
-- mail_* 로 대체된 뒤 남아 있던 잔재다. 2026-08-19 프로덕션 실측 기준 네 테이블 모두 0행이고
-- 앱 코드 참조도 0건이다. 0077 에서 anon 권한만 회수해뒀던 것을 여기서 실제로 지운다.
--
-- 함께 제거하는 contact_attempts.campaign_id 에 대하여:
--   이 컬럼은 email_campaigns 를 가리키는 FK 였다. attempt_source enum 의 'email' 값과 짝을
--   이루는, "캠페인 메일 발송 시 컨택 시도를 자동 기록" 하려던 미완성 설계의 흔적이다. 767행
--   중 값이 들어간 행은 0개이고 앱은 이 컬럼을 읽지도 쓰지도 않는다. 참조 대상 테이블이
--   사라지므로 컬럼도 함께 지운다 — 죽은 테이블을 가리키는 FK 를 남기는 것이 더 나쁘다.
--   기능을 되살릴 때는 mail_campaigns 를 가리키는 컬럼을 새로 추가하면 된다.
--   0079 가 이 컬럼을 복구했다가 여기서 지우는 모양이 되는데, 0079 는 "프로덕션 상태 복구",
--   0080 은 "정리"라 목적이 다르다. 재생 순서상 최종 상태는 동일하다.
--
-- attempt_source 와 그 enum(contact_attempt_source)은 남긴다. 767행 전부 기본값 'manual' 이라
-- 정보량은 없으나, 기능을 되살릴 때 그대로 쓸 수 있고 유지 비용이 없다.
--
-- 되돌리기: 이 마이그레이션은 되돌릴 수 없다. 대상이 전부 0행이라 데이터 손실은 없다.

BEGIN;

-- 1) 레거시 캠페인을 가리키던 FK 와 컬럼
ALTER TABLE contact_attempts DROP CONSTRAINT IF EXISTS contact_attempts_campaign_id_fkey;
ALTER TABLE contact_attempts DROP COLUMN IF EXISTS campaign_id;

-- 2) 테이블 — 의존 순서대로 (자식 먼저)
DROP TABLE IF EXISTS email_campaign_recipients;
DROP TABLE IF EXISTS email_attachments;
DROP TABLE IF EXISTS email_campaigns;
DROP TABLE IF EXISTS email_templates;

-- 3) 위 테이블에서만 쓰이던 enum
DROP TYPE IF EXISTS email_recipient_status;
DROP TYPE IF EXISTS email_campaign_status;

-- 4) 레거시 캠페인 회차 발번 함수
DROP FUNCTION IF EXISTS public.next_email_campaign_no(uuid);

COMMIT;
