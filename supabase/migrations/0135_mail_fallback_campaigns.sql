-- 메일 대체 발송 — 실패·반송된 수신자에게 발송 주소 순서의 다음 이메일 열로 자동 재발송 (2026-10-16)
--
-- 원래 회차(부모) 아래 kind='fallback' 회차를 하나 붙이고 그 회차의 수신자로 넣는다.
-- 수신자 한 줄 = (회차, 조사 대상) 유일 제약을 그대로 쓰기 위해 같은 회차가 아니라 자식 회차에 쌓는다.
-- 대체 발송이 또 반송되면 그 대체 회차의 자식 대체 회차로 이어진다(3순위 …).

-- 1) 회차 종류에 'fallback' 추가
ALTER TABLE mail_campaigns DROP CONSTRAINT IF EXISTS mail_campaigns_kind_check;
ALTER TABLE mail_campaigns
  ADD CONSTRAINT mail_campaigns_kind_check CHECK (kind IN ('bulk', 'single', 'fallback'));

-- 2) 대체 회차의 부모 회차 — 부모마다 대체 회차는 하나
ALTER TABLE mail_campaigns
  ADD COLUMN IF NOT EXISTS parent_campaign_id uuid REFERENCES mail_campaigns(id) ON DELETE SET NULL;
CREATE UNIQUE INDEX IF NOT EXISTS mail_campaigns_fallback_parent_unique
  ON mail_campaigns (parent_campaign_id)
  WHERE kind = 'fallback' AND parent_campaign_id IS NOT NULL;

-- 3) 수신자가 쓴 이메일 열과 대체 발송의 출처 수신자
--    email_column_key 가 없으면(이 컬럼 이전 행) 주소 값을 명단과 맞춰 열을 찾는다.
ALTER TABLE mail_recipients ADD COLUMN IF NOT EXISTS email_column_key text;
ALTER TABLE mail_recipients
  ADD COLUMN IF NOT EXISTS source_recipient_id uuid REFERENCES mail_recipients(id) ON DELETE SET NULL;

-- 4) 대체 회차 발번 — 2000001+ 대역으로 단체(1~)·단건(1000001~)과 격리, 같은 advisory lock 키로 직렬화
CREATE OR REPLACE FUNCTION public.next_fallback_run_number(p_survey_id uuid, p_is_test boolean DEFAULT false)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY INVOKER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT GREATEST(COALESCE(MAX(run_number),0), 2000000)+1 INTO v_next FROM mail_campaigns
   WHERE survey_id=p_survey_id AND is_test=p_is_test AND kind='fallback';
  RETURN v_next;
END;
$function$;

-- 0081 과 같은 방침 — 앱은 postgres 롤로만 부른다. PUBLIC 기본 EXECUTE 를 회수한다.
REVOKE EXECUTE ON FUNCTION public.next_fallback_run_number(uuid, boolean) FROM PUBLIC, anon, authenticated;
