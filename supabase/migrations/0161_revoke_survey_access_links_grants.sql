-- 0161: 링크 표(`survey_access_links`)에서 anon·authenticated 의 테이블 권한을 걷는다. (2026-11-10)
--
-- 0126 이 이 표를 만들 때(옛 이름 `survey_fieldwork_links`) RLS 만 켜고 REVOKE 를 빠뜨렸다. Supabase
-- 프로젝트는 postgres 가 만든 표에 anon·authenticated 권한을 기본으로 주므로, 손으로 적용한 DB 에는
-- 그 권한이 남는다(0134 의 개명은 권한을 그대로 옮긴다). 빈 DB 재생본에는 그 기본 권한이 없어서
-- 재생 검증으로는 보이지 않았고, `pnpm db:drift staging` 이 「실 DB 에만 있는 권한」으로 잡았다.
--
-- RLS 가 켜져 있고 정책이 없어 행은 원래 읽히지 않는다 — 걷는 것은 권한 표면이다. 이 레포의 새 표는
-- 모두 같은 줄을 둔다(0037·0081, 그 뒤 표마다).
--
-- 재생·재적용: REVOKE 는 권한이 없어도 성공한다.

BEGIN;

REVOKE ALL ON TABLE survey_access_links FROM anon, authenticated;

COMMIT;
