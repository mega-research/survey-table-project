-- 0081: public 스키마 전체에서 anon·authenticated 권한 회수. (2026-08-19)
--
-- 배경: 0037 은 ALTER DEFAULT PRIVILEGES 로 "앞으로 만들어질" 테이블의 기본 GRANT 만 막았고,
-- 그 시점에 이미 있던 테이블은 회수하지 않았다. 그래서 2026-08-19 실측 기준 surveys,
-- questions, survey_responses, contact_attempts 등 18개 테이블에 anon=arwdDxtm(읽기·쓰기·
-- 삭제 전부)가 남아 있었다. 함수도 마찬가지로 Supabase 기본 EXECUTE 가 6개에 남아 있었다
-- (0039 는 lookup_contact_by_invite_token 하나만 회수했다).
--
-- 현재 노출은 없다. 대상 테이블 18개 모두 RLS 가 켜져 있고 정책이 0개라 anon 은 한 행도
-- 읽거나 쓰지 못한다. 문제는 방어가 RLS 한 겹뿐이고 GRANT 가 그 밑에 그대로 깔려 있다는
-- 점이다 — 어느 테이블에든 정책을 하나 추가하는 순간 anon 의 전체 권한이 살아난다.
--
-- 안전성: 앱은 DATABASE_URL 의 postgres 롤로 접속한다. anon 키를 쓰는 곳은
-- lib/supabase/{server,middleware}.ts 뿐이고 전부 auth API(getUser/signIn/signOut)만
-- 호출한다 — auth 스키마 소관이라 public 스키마 권한과 무관하다. 브라우저 클라이언트
-- (lib/supabase/client.ts)는 어디서도 import 되지 않는 죽은 코드다.
--
-- 개별 나열 대신 스키마 전체를 대상으로 한다. 목록을 손으로 관리하면 이번처럼 빠뜨린 것이
-- 다시 쌓인다. 신규 객체는 0037 의 기본 권한 설정이 막는다.

BEGIN;

REVOKE ALL ON ALL TABLES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;

-- 함수는 PUBLIC 기본 EXECUTE 도 함께 회수한다 (0075 가 lookup_contact_by_invite_token 에
-- 했던 것과 같다). 회수 대상: next_campaign_run_number, next_single_send_run_number,
-- next_contact_resid, reconcile_campaign_counters, sweep_expired_pii, sweep_stale_sessions.
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM PUBLIC;

COMMIT;
