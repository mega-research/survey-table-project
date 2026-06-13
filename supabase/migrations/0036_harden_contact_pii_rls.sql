-- 0036_harden_contact_pii_rls.sql
-- 적용: 미적용 (검증 전용 — 사용자가 후속으로 Supabase MCP apply_migration 으로 운영 DB 적용).
--       drizzle _journal.json 비대상 (0020~0035 와 동일한 MCP 수동 적용 관행).
--
-- 목적 (#8): contact_targets / contact_pii 의 authenticated permissive 정책을 제거하고
--   anon / authenticated 의 테이블 GRANT 를 회수하여 0035 의 deny-all 패턴과 정합시킨다.
--
-- 배경: 0019 가 두 테이블에 RLS 를 켜면서 owner-only(FOR ALL TO authenticated) 정책
--   (contact_targets_owner_all · contact_pii_owner_all)을 함께 만들었다. 그러나 이 앱은
--   모든 데이터 접근을 Drizzle(DATABASE_URL=postgres, BYPASSRLS) / service_role(BYPASSRLS)
--   로만 하고, anon / authenticated 롤로 이 테이블들을 직접 쿼리하지 않는다(supabase JS
--   클라이언트는 supabase.auth.* 세션 용도로만 쓰이며 .from()/.rpc() 로 테이블을 읽지 않음).
--   따라서 authenticated 정책은 사용처가 없는 잔여 노출 경로이고, anon/authenticated 의
--   풀 테이블 GRANT(arwdDxt) 는 Supabase 의 public 스키마 기본 GRANT 가 남긴 것이다.
--   정책을 제거하면 RLS-on + 정책 0 → deny-all 이 되어 0035 의 다른 public 테이블과 동일한
--   service-role 전용 구성이 된다. GRANT 회수는 심층 방어(RLS 가 끊겨도 롤 GRANT 로
--   노출되지 않도록).
--
-- 안전성: DROP POLICY / REVOKE 는 데이터 행과 무관(스키마/권한 메타만 변경). TRUNCATE 등
--   데이터 파괴 연산을 일절 포함하지 않는다. 멱등(IF EXISTS).

BEGIN;

-- 1) authenticated permissive 정책 제거 → RLS-on + 정책 0 = deny-all (0035 정합)
DROP POLICY IF EXISTS "contact_targets_owner_all" ON "contact_targets";
DROP POLICY IF EXISTS "contact_pii_owner_all" ON "contact_pii";

-- 2) anon / authenticated 테이블 GRANT 회수 (심층 방어 — service_role/postgres 는 유지)
REVOKE ALL ON TABLE "contact_targets" FROM anon, authenticated;
REVOKE ALL ON TABLE "contact_pii" FROM anon, authenticated;

COMMIT;

-- 검증(적용 후 읽기 전용 확인용):
--   SELECT policyname FROM pg_policies
--     WHERE schemaname='public' AND tablename IN ('contact_targets','contact_pii');
--   -- 기대: 0행
--   SELECT grantee, privilege_type FROM information_schema.role_table_grants
--     WHERE table_schema='public' AND table_name IN ('contact_targets','contact_pii')
--       AND grantee IN ('anon','authenticated');
--   -- 기대: 0행
--
-- Rollback (참고용 — 0019 의 정책/GRANT 복원):
--   GRANT ALL ON TABLE "contact_targets" TO anon, authenticated;
--   GRANT ALL ON TABLE "contact_pii" TO anon, authenticated;
--   -- 정책 재생성은 0019_lyrical_roland_deschain.sql 의 CREATE POLICY 블록 참조.
