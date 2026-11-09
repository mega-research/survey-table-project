-- 0160: 외주 실사 링크의 담당 범위 — 조사 대상 × 외주 링크 표와 링크의 「나눈 적 있음」. (2026-11-09, ADR-0035)
--
-- 한 설문을 외주 업체 여럿에 나눠 맡기면 링크마다 **볼 수 있는 조사 대상**을 정한다
-- (.scratch/fieldwork-multi-company 티켓 03). 담당 범위는 컨택원과 다른 층이다 — 컨택원은 「누가 걸
-- 차례인가」, 담당 범위는 「누가 볼 수 있나」. 컨택원 교체 적용은 이 표를 건드리지 않는다.
--
-- ## fieldwork_link_shares
--
-- 행 하나 = 「이 조사 대상은 지금 이 외주 링크에 맡겨져 있다」. 같이 맡기기(티켓 04)가 있어 다대다다
-- — 키는 (link_id, contact_target_id) 쌍. 첫 칸이 link_id 라 「이 링크의 범위」 서브쿼리를 PK 가 받고,
-- contact_target_id 인덱스는 대상 쪽(겹침 집계·대상 삭제 cascade)을 받는다.
--
-- - contact_target_id → contact_targets ON DELETE CASCADE: 대상이 지워지면(명단 교체 업로드) 범위도
--   풀린다. 교체 업로드가 담당 범위를 푸는 것은 이 성질의 결과다(티켓 09).
-- - link_id → survey_access_links: ON DELETE 를 적지 않는다(NO ACTION). 링크 행은 종료돼도 지우지
--   않으므로 RESTRICT 와 같은 뜻이지만, 검사가 **문장 끝**이라 설문 하드 삭제가 링크·대상을 함께
--   cascade 로 지울 때 어느 쪽이 먼저 지워져도 막히지 않는다(RESTRICT 는 즉시 검사라 cascade 순서에
--   따라 설문 삭제가 깨질 수 있다). 링크 종료가 범위를 푸는 것은 앱이 같은 트랜잭션에서 지운다(티켓 09).
-- - 「실데이터 대상만」·「외주 링크만」·「같은 설문의 대상과 링크」는 교차 테이블 조건이라 DB 로 걸지
--   않는다 — 쓰기 경로는 나누기 적용 하나뿐이고 그 서비스가 잠근 행에서 다시 본다.
--
-- ## survey_access_links.share_applied_at · share_clauses
--
-- `share_applied_at` 이 「나눈 적 있음」이다 — NULL 이면 한 번도 나누지 않은 링크라 **설문 전체**를
-- 보고, 값이 있으면 범위 표의 행만 본다(0명이어도 0명). 「담당 범위 없애기」가 NULL 로 되돌린다.
-- `share_clauses` 는 마지막으로 적용한 조건(컨택원의 last_clauses 와 같은 모양)이라 수정 화면을 다시
-- 열면 채운다. 둘 다 외주 링크 전용이고 함께 서고 함께 빈다.
--
-- ## 배포
--
-- 새 표·nullable 칸뿐이라 구버전 앱과 양립한다 — 앱 배포 **전**에 적용한다. 승격 순서상 외주·
-- 클라이언트 링크 묶음(0126·0127·0133·0134)과 0159 뒤다.
--
-- RLS: 0035 하우스 룰 — ENABLE + 정책 0개(anon/authenticated deny-all, 앱은 postgres 롤).
-- 멱등 (IF NOT EXISTS) — 빈 DB 재생과 재적용 양쪽 안전.

BEGIN;

ALTER TABLE survey_access_links ADD COLUMN IF NOT EXISTS share_applied_at timestamptz;
ALTER TABLE survey_access_links ADD COLUMN IF NOT EXISTS share_clauses jsonb;

ALTER TABLE survey_access_links DROP CONSTRAINT IF EXISTS survey_access_links_share_check;
ALTER TABLE survey_access_links
  ADD CONSTRAINT survey_access_links_share_check
  CHECK (
    (share_applied_at IS NULL) = (share_clauses IS NULL)
    AND (share_applied_at IS NULL OR kind = 'fieldwork')
  );

CREATE TABLE IF NOT EXISTS fieldwork_link_shares (
  link_id uuid NOT NULL REFERENCES survey_access_links (id),
  contact_target_id uuid NOT NULL REFERENCES contact_targets (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fieldwork_link_shares_pk PRIMARY KEY (link_id, contact_target_id)
);

CREATE INDEX IF NOT EXISTS fieldwork_link_shares_target_idx
  ON fieldwork_link_shares (contact_target_id);

COMMENT ON TABLE fieldwork_link_shares IS
  '외주 실사 링크의 담당 범위 — 조사 대상 × 외주 링크(다대다). 그 링크로 들어온 외주가 볼 수 있는 대상의 경계. 컨택원과 무관 (0160, ADR-0035)';
COMMENT ON COLUMN survey_access_links.share_applied_at IS
  '담당 범위를 나눈 적 있음 — NULL 이면 설문 전체를 본다, 값이 있으면 fieldwork_link_shares 의 대상만(0명이어도). 외주 링크 전용 (0160)';
COMMENT ON COLUMN survey_access_links.share_clauses IS
  '마지막으로 적용한 담당 범위 조건({ source, value, op }[]) — 수정 화면을 다시 열면 채운다. share_applied_at 과 함께 서고 함께 빈다 (0160)';

ALTER TABLE fieldwork_link_shares ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE fieldwork_link_shares FROM anon, authenticated;

COMMIT;
