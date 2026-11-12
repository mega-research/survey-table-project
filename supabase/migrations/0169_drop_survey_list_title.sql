-- 0169: 운영(hotfix)의 임시 카드 제목 열 list_title(0167)을 지운다 (2026-11-12)
--
-- 값은 0168 이 card_title(0140)로 옮겼다. **앱 배포 뒤**에 적용한다 — 승격 전 운영 앱은 목록 조회와
-- 「카드 제목 바꾸기」가 이 열을 읽고 쓰므로, 먼저 지우면 설문 목록이 깨진다.
-- 0167 을 적용한 적 없는 DB(스테이징)에서는 아무것도 하지 않는다.

BEGIN;

ALTER TABLE public.surveys DROP COLUMN IF EXISTS list_title;

COMMIT;
