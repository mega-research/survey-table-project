-- 0039: lookup_contact_by_invite_token 의 anon/authenticated EXECUTE 회수.
--
-- 이 함수는 SECURITY DEFINER 라 owner(postgres, BYPASSRLS)로 실행되어 contact_targets
-- 의 RLS deny-all(0036)을 정의상 우회한다. anon/authenticated 에 EXECUTE 가 부여돼
-- 있으면 publishable(anon) key 만으로 PostgREST POST /rest/v1/rpc/lookup_contact_by_invite_token
-- 를 통해 invite_token 유효성 오라클로 악용 가능하고, 앱 rate limiter 도 우회된다.
--
-- 앱은 Drizzle postgres 롤(owner)로 직접 SELECT 호출하므로(src/lib/duplicate-detection/
-- invite-lookup.ts:44) anon/authenticated 회수는 앱에 무영향. 코드베이스에 .rpc() 호출 0건.
--
-- _journal.json 비대상 — 0035~0038 과 동일한 수동 SQL(MCP apply_migration) 관행.
-- 롤백: GRANT EXECUTE ON FUNCTION public.lookup_contact_by_invite_token(uuid, uuid) TO anon, authenticated;

-- prod DDL 안전장치: 락을 3초 내 못 잡으면 전체 차단 대신 fail-fast (단일 운영환경 보호).
SET LOCAL lock_timeout = '3s';

-- 2026-08-19 재생 가능성 수선: 이 함수는 어떤 마이그레이션도 만들지 않아(0075 가 뒤늦게 복구)
-- 빈 DB 재생 시 이 시점에는 존재하지 않는다. 없으면 건너뛴다 — 0075 가 같은 REVOKE 를 수행하므로
-- 최종 상태는 동일하다.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'lookup_contact_by_invite_token'
  ) THEN
    REVOKE EXECUTE ON FUNCTION public.lookup_contact_by_invite_token(uuid, uuid) FROM anon, authenticated;
  END IF;
END $$;
