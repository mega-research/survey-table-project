-- 0083: 권한 회수 이벤트 트리거의 REVOKE 대상을 ROUTINE 으로 교정. (2026-08-19)
--
-- 문제: 0082 의 트리거는 CREATE FUNCTION 과 CREATE PROCEDURE 태그를 모두 포착하면서
-- 회수 구문은 둘 다 REVOKE EXECUTE ON FUNCTION 을 실행한다. PostgreSQL 에서 프로시저는
-- FUNCTION 대상이 아니므로, public 스키마에 프로시저를 처음 만드는 순간 ddl_command_end
-- 트리거가 에러를 내고 원래 CREATE PROCEDURE DDL 전체가 롤백된다.
--
-- ON ROUTINE 은 함수와 프로시저를 모두 포괄한다(PG11+). CREATE OR REPLACE 는 기존
-- 함수의 oid 와 ACL(0082 말미의 자기 자신 회수 포함)을 보존하므로 이벤트 트리거 재생성이나
-- 재회수는 불필요하다.

BEGIN;

CREATE OR REPLACE FUNCTION public.revoke_anon_execute_on_new_functions()
 RETURNS event_trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE obj record;
BEGIN
  FOR obj IN
    SELECT object_identity
    FROM pg_event_trigger_ddl_commands()
    WHERE command_tag IN ('CREATE FUNCTION', 'CREATE PROCEDURE')
      AND schema_name = 'public'
  LOOP
    -- object_identity 는 이미 스키마 한정 + 인자 시그니처를 포함한다.
    -- ROUTINE 은 함수·프로시저 공용 대상 — 프로시저에 ON FUNCTION 을 쓰면 에러로
    -- 원래 DDL 이 롤백된다 (0082 의 결함).
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM PUBLIC', obj.object_identity);
    EXECUTE format('REVOKE EXECUTE ON ROUTINE %s FROM anon, authenticated', obj.object_identity);
  END LOOP;
END;
$function$;

COMMIT;
