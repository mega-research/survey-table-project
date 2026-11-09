-- 0159: 외주 실사 링크를 설문당 여럿 열고, 링크에 연구원용 이름표를 단다. (2026-11-09, ADR-0035)
--
-- 한 설문을 외주 업체 여럿에 나눠 맡기면 **업체마다 외주 링크 하나**를 발급한다
-- (.scratch/fieldwork-multi-company 티켓 02). 클라이언트 링크는 그대로 설문당 하나다.
--
-- ## 활성 링크 유일 제약을 클라이언트 링크로 좁힌다
--
-- 0134 의 `survey_access_links_active_survey_kind_uq`(survey_id, kind WHERE closed_at IS NULL)를
-- `survey_access_links_active_client_uq`(survey_id WHERE kind='client' AND closed_at IS NULL)로
-- 바꾼다. 새 유일 인덱스를 **먼저** 만들고 옛것을 지운다 — 한 트랜잭션이라 사이에 틈은 없지만,
-- 순서를 바꾸면 중간 상태가 클라이언트 링크 둘을 허용하는 꼴이 된다. 목록 조회(설문 + 종류의 열린
-- 링크)가 쓰던 인덱스 자리는 같은 열의 비유일 부분 인덱스가 잇는다.
--
-- ## label
--
-- 링크의 이름표(「프롬」·「프라임」) — 연구원이 내부 화면에서 링크를 구별하는 메모다. 외주 콘솔·
-- 비밀번호 화면에는 싣지 않는다(앱이 지킨다). nullable 이고 비우면 화면이 발급 순번으로 구별한다.
-- **외주 링크에만 있다** — 클라이언트 링크는 설문당 하나라 구별할 것이 없다. 1~40자. 공백 정돈은
-- 앱의 경계 스키마가 한다(빈 문자열은 NULL 로 접어 저장한다).
--
-- ## 배포
--
-- 새 칸(nullable) 추가와 제약 완화뿐이라 구버전 앱과 양립한다 — 앱 배포 **전**에 적용한다. 구버전
-- 앱의 외주 링크 발급은 이제 CONFLICT 대신 두 번째 링크를 만들 수 있으나, 그 앱의 화면은 첫 링크만
-- 그린다(무해). 승격 순서상 외주·클라이언트 링크 묶음(0126·0127·0133·0134) 뒤다.

BEGIN;

ALTER TABLE survey_access_links ADD COLUMN IF NOT EXISTS label text;

ALTER TABLE survey_access_links DROP CONSTRAINT IF EXISTS survey_access_links_label_check;
ALTER TABLE survey_access_links
  ADD CONSTRAINT survey_access_links_label_check
  CHECK (label IS NULL OR (kind = 'fieldwork' AND char_length(label) BETWEEN 1 AND 40));

CREATE UNIQUE INDEX IF NOT EXISTS survey_access_links_active_client_uq
  ON survey_access_links (survey_id)
  WHERE kind = 'client' AND closed_at IS NULL;

DROP INDEX IF EXISTS survey_access_links_active_survey_kind_uq;

CREATE INDEX IF NOT EXISTS survey_access_links_active_survey_kind_idx
  ON survey_access_links (survey_id, kind)
  WHERE closed_at IS NULL;

COMMENT ON COLUMN survey_access_links.kind IS
  '링크의 종류 — fieldwork(외주 실사: 운영 콘솔) | client(클라이언트: 현황 열람). 활성 클라이언트 링크는 설문당 하나, 외주 링크는 업체 수만큼';
COMMENT ON COLUMN survey_access_links.label IS
  '외주 링크의 연구원용 이름표(1~40자, 외주 링크 전용). 내부 화면에서만 읽는다 — 외주 콘솔·비밀번호 화면에 싣지 않는다. NULL 이면 발급 순번으로 구별한다 (0159, ADR-0035)';

COMMIT;
