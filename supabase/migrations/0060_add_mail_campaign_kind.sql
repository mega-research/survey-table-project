-- 단건 메일 발송: mail_campaigns.kind 구분 + 발번 함수 kind 격리
ALTER TABLE mail_campaigns ADD COLUMN kind text NOT NULL DEFAULT 'bulk';
ALTER TABLE mail_campaigns
  ADD CONSTRAINT mail_campaigns_kind_check CHECK (kind IN ('bulk', 'single'));

-- 기존 발번 함수를 bulk 전용으로 격리 (single 1000001+ 대역 오염 방지)
CREATE OR REPLACE FUNCTION next_campaign_run_number(p_survey_id uuid, p_is_test boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT COALESCE(MAX(run_number),0)+1 INTO v_next FROM mail_campaigns
   WHERE survey_id=p_survey_id AND is_test=p_is_test AND kind='bulk';
  RETURN v_next;
END;
$$;

-- 단건 발송 발번: 1000001부터 (같은 advisory lock 키로 bulk 발번과 직렬화)
CREATE FUNCTION next_single_send_run_number(p_survey_id uuid, p_is_test boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT GREATEST(COALESCE(MAX(run_number),0), 1000000)+1 INTO v_next FROM mail_campaigns
   WHERE survey_id=p_survey_id AND is_test=p_is_test AND kind='single';
  RETURN v_next;
END;
$$;
