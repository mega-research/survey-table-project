-- 0148: 클라이언트 링크의 응답 내역 열 설정. (2026-11-02)
--
-- 클라이언트 링크의 응답 내역 탭(0144 의 `responses` 칩)이 보일 열을 연구원이 고른다 — 내부 응답
-- 내역 컬럼 설정(`surveys.profile_columns`)과 따로 링크 행에 둔다(`.scratch/client-link-response-list`
-- 티켓 04). 링크를 종료하고 다시 발급하면 새 행이라 기본 열부터 다시 시작한다 — 탭과 같다.
--
-- 모양은 `{ "version": number, "keys": string[] }` 이다(순서 = 배열 순서). `version` 은 낙관 잠금이다:
-- 열은 순서가 있는 목록이라 칩처럼 한 칸씩 받지 못해, 낡은 화면의 저장이 남이 뺀 열을 되살리지
-- 않도록 저장마다 1 씩 올리고 서비스가 대조한다. NULL 은 기본 열(순번·상태·시작·종료·소요시간)이고
-- version 0 이다. 열 키의 허용 어휘(개인정보·암호화 칸·IP 해시 제외)는 설문 구조에 달려 CHECK 로
-- 못 건다 — 쓰기·읽기 양쪽이 lib/operations/client-response-columns-format 의 판정 하나를 부른다.
--
-- 이 파일 번호: 0144 는 클라이언트 링크 칩 백필, 0145~0147 은 main(다국어 설문 글자·표 줄이기·
-- 척도 평균)이 썼다 — 그래서 0148 이다.
--
-- 배포: 앱보다 먼저 적용한다(새 앱이 이 컬럼을 select 한다). nullable 이라 옛 앱 INSERT 는 무관하다.
-- 프로덕션은 survey_access_links 자체가 아직 없다 — 승격 런북의 링크 묶음(0126·0127·0133·0134) 뒤,
-- 0144 다음에 적용한다.
BEGIN;

ALTER TABLE survey_access_links
  ADD COLUMN IF NOT EXISTS client_response_columns jsonb;

ALTER TABLE survey_access_links
  DROP CONSTRAINT IF EXISTS survey_access_links_client_response_columns_check;
ALTER TABLE survey_access_links
  ADD CONSTRAINT survey_access_links_client_response_columns_check
  CHECK (kind = 'client' OR client_response_columns IS NULL);

COMMENT ON COLUMN survey_access_links.client_response_columns IS
  '클라이언트 링크의 응답 내역 열 {version, keys}. NULL 이면 기본 열. 외주 링크에서는 항상 NULL (0148)';

COMMIT;
