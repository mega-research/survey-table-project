-- 0075: 앱이 호출하는 DB 함수 4종의 정의를 레포로 복구한다. (2026-08-19)
-- 배경: 이 함수들은 프로덕션에 존재하지만 레포에 정의가 없거나 흩어져 있었다.
--   - lookup_contact_by_invite_token: **어떤 마이그레이션도 생성하지 않았다.**
--     0039 가 REVOKE 만 하고 있어, 빈 DB 에서는 재구성이 불가능했다.
--   - next_campaign_run_number / next_single_send_run_number / next_contact_resid:
--     0014·0015·0020·0057·0060 에 분산돼 있고, 그 파일들은 테이블·컬럼 생성문과
--     한 트랜잭션으로 묶여 있어 스키마가 이미 있는 DB 에서는 통째로 롤백된다.
--
-- 아래 정의는 2026-08-19 staging(프로덕션 클론)의 pg_get_functiondef 출력을 그대로
-- 옮긴 것이다. 전부 CREATE OR REPLACE 라 이미 같은 정의를 가진 DB 에는 무해하다.
-- 이후 함수를 바꾸려면 이 파일이 아니라 새 마이그레이션을 추가할 것 (뒤에 적용된 것이 이긴다).

BEGIN;

-- 컨택 resid 발번 — 설문+scope 단위 advisory lock 으로 동시 삽입 직렬화
CREATE OR REPLACE FUNCTION public.next_contact_resid(p_survey_id uuid, p_is_test boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT COALESCE(MAX(resid),0)+1 INTO v_next FROM contact_targets
   WHERE survey_id=p_survey_id AND is_test=p_is_test;
  RETURN v_next;
END;
$function$;

-- 단체 캠페인 회차 발번
CREATE OR REPLACE FUNCTION public.next_campaign_run_number(p_survey_id uuid, p_is_test boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT COALESCE(MAX(run_number),0)+1 INTO v_next FROM mail_campaigns
   WHERE survey_id=p_survey_id AND is_test=p_is_test AND kind='bulk';
  RETURN v_next;
END;
$function$;

-- 단건 발송 회차 발번 — 1000001+ 대역으로 단체 캠페인과 격리
CREATE OR REPLACE FUNCTION public.next_single_send_run_number(p_survey_id uuid, p_is_test boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT GREATEST(COALESCE(MAX(run_number),0), 1000000)+1 INTO v_next FROM mail_campaigns
   WHERE survey_id=p_survey_id AND is_test=p_is_test AND kind='single';
  RETURN v_next;
END;
$function$;

-- invite token → contact_target id 조회 (SECURITY DEFINER)
CREATE OR REPLACE FUNCTION public.lookup_contact_by_invite_token(p_survey_id uuid, p_invite_token uuid)
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT id FROM public.contact_targets
  WHERE survey_id = p_survey_id
    AND invite_token = p_invite_token
  LIMIT 1;
$function$;

-- 0039 와 동일한 회수. 이 함수가 여기서 처음 생성되는 빈 DB 에서는 PUBLIC 기본 EXECUTE 가
-- 붙으므로, 0039 의 의도(publishable/anon 키만으로 PostgREST rpc 호출 차단)를 여기서 함께 건다.
REVOKE EXECUTE ON FUNCTION public.lookup_contact_by_invite_token(uuid, uuid) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.lookup_contact_by_invite_token(uuid, uuid) FROM anon, authenticated;

COMMIT;
