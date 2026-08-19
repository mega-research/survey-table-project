-- 0082: 새로 만들어지는 함수의 익명 EXECUTE 를 생성 시점에 자동 회수. (2026-08-19)
--
-- 문제: 0081 은 "그 시점에 존재하는" 함수의 권한만 회수했다. PostgreSQL 은 CREATE FUNCTION
-- 시 PUBLIC 에 EXECUTE 를 자동 부여하고 anon·authenticated 는 PUBLIC 에 포함되므로, 새 함수를
-- 하나 만들 때마다 익명 실행이 조용히 다시 열린다. SECURITY DEFINER 함수가 이 경로로 열리면
-- RLS 를 우회한 익명 RPC 가 된다 — lookup_contact_by_invite_token 이 실제로 그 형태였고
-- 0039 가 뒤늦게 개별 회수했었다.
--
-- ALTER DEFAULT PRIVILEGES 를 쓰지 않는 이유: 이 Supabase 빌드에서 함수에 대해 동작하지
-- 않는다. 2026-08-19 실측 — postgres 롤의 public 스키마 함수 기본 ACL 을 postgres=X 로
-- 남겨도(즉 PUBLIC 회수 상태) 새 함수의 proacl 은 NULL 로 생성되고
-- has_function_privilege('anon', ..., 'EXECUTE') 는 true 였다. public 이 아닌 새 스키마에서도
-- 같았다. 반면 명시적 REVOKE 는 확실히 동작한다. 그래서 "기본값을 바꾸는" 대신 "생성 직후
-- 명시적으로 회수하는" 이벤트 트리거로 간다.
--
-- 이 트리거는 예방이고, 탐지는 pnpm db:drift 의 실효 권한 검사(has_function_privilege)가
-- 맡는다. 둘 중 하나가 뚫려도 나머지가 잡는다.

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
    -- object_identity 는 이미 스키마 한정 + 인자 시그니처를 포함한다
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM PUBLIC', obj.object_identity);
    EXECUTE format('REVOKE EXECUTE ON FUNCTION %s FROM anon, authenticated', obj.object_identity);
  END LOOP;
END;
$function$;

DROP EVENT TRIGGER IF EXISTS revoke_anon_execute_on_new_functions;
CREATE EVENT TRIGGER revoke_anon_execute_on_new_functions
  ON ddl_command_end
  WHEN TAG IN ('CREATE FUNCTION', 'CREATE PROCEDURE')
  EXECUTE FUNCTION public.revoke_anon_execute_on_new_functions();

-- 트리거 함수 자신도 예외가 아니다 — 위 CREATE 시점에는 트리거가 아직 없었다.
REVOKE EXECUTE ON FUNCTION public.revoke_anon_execute_on_new_functions() FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.revoke_anon_execute_on_new_functions() FROM anon, authenticated;

COMMIT;
