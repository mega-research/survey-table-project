-- 0037_revoke_default_table_grants.sql
-- 적용: 미적용 (검증 전용 — 사용자가 후속으로 Supabase MCP apply_migration 으로 운영 DB 적용).
--       drizzle _journal.json 비대상 (0020~0035 와 동일한 MCP 수동 적용 관행).
--
-- 목적 (#19): 신규 public 테이블이 anon / authenticated 에게 자동 GRANT 되는 것을 차단한다.
--
-- 배경: Supabase 의 public 스키마는 ALTER DEFAULT PRIVILEGES 로 postgres / supabase_admin
--   이 만드는 테이블에 anon / authenticated / service_role 풀 GRANT(arwdDxt)를 자동 부여한다.
--   Drizzle 은 DATABASE_URL=postgres 로 마이그레이션을 적용하므로, 신규 테이블마다 RLS 를
--   켜는 것을 잊으면 anon GRANT + RLS-off 조합으로 공개 노출되는 footgun 이 있다
--   (메모: feedback_drizzle_supabase_rls_footgun). 0035 에서 22개 테이블 RLS 를 일괄
--   활성했지만, 그것은 사후 교정이다. 이 마이그레이션은 기본 GRANT 자체를 끊어 신규 테이블이
--   "RLS 깜빡 + anon GRANT" 상태로 만들어지는 것을 원천 차단한다(심층 방어).
--
-- 범위: postgres / supabase_admin 두 owner 의 public 스키마 테이블(객체 타입 r) 기본 GRANT 만
--   다룬다. 시퀀스(S) / 함수(f) 는 이 슬라이스 범위 밖(이 앱은 anon/authenticated 로 직접
--   접근하지 않으나, 잠재 변경 영향이 더 넓어 분리). 이미 존재하는 테이블의 GRANT 는 바뀌지
--   않는다(ALTER DEFAULT PRIVILEGES 는 향후 생성분에만 적용) — 기존 테이블은 0035 + 0036 이
--   RLS / GRANT 로 이미 정합.
--
-- 안전성: 권한 메타만 변경. 데이터 행 무관. 멱등(같은 REVOKE 를 다시 실행해도 무해).

BEGIN;

-- postgres(=Drizzle 마이그레이션 롤) 가 향후 만드는 public 테이블의 anon/authenticated 기본 GRANT 차단
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

-- supabase_admin(스튜디오/마이그레이션 일부 경로) 가 향후 만드는 public 테이블도 동일 차단
ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
  REVOKE ALL ON TABLES FROM anon, authenticated;

COMMIT;

-- 검증(적용 후 읽기 전용 확인용):
--   SELECT pg_get_userbyid(defaclrole) AS owner, defaclobjtype AS objtype,
--          array_to_string(defaclacl, ', ') AS default_acl
--     FROM pg_default_acl d
--     JOIN pg_namespace n ON n.oid = d.defaclnamespace
--    WHERE n.nspname='public' AND d.defaclobjtype='r';
--   -- 기대: objtype 'r' 의 default_acl 에 anon=.../authenticated=... 항목이 사라짐
--   --       (service_role / postgres 항목은 유지).
--
-- Rollback (참고용 — Supabase 기본값 복원):
--   ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated;
--   ALTER DEFAULT PRIVILEGES FOR ROLE supabase_admin IN SCHEMA public
--     GRANT ALL ON TABLES TO anon, authenticated;
