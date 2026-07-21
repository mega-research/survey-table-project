BEGIN;

ALTER TABLE surveys ADD COLUMN test_contact_columns jsonb;
ALTER TABLE contact_targets ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE mail_campaigns ADD COLUMN is_test boolean NOT NULL DEFAULT false;
ALTER TABLE mail_campaigns ADD COLUMN archived_at timestamptz;
ALTER TABLE mail_recipients ADD COLUMN archived_at timestamptz;

ALTER TABLE contact_targets DROP CONSTRAINT contact_targets_survey_resid_unique;
ALTER TABLE contact_targets ADD CONSTRAINT contact_targets_survey_scope_resid_unique UNIQUE (survey_id,is_test,resid);
ALTER TABLE mail_campaigns DROP CONSTRAINT mail_campaigns_survey_run_unique;
ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_survey_scope_run_unique UNIQUE (survey_id,is_test,run_number);

ALTER TABLE mail_recipients ALTER COLUMN contact_target_id DROP NOT NULL;
ALTER TABLE mail_recipients ALTER COLUMN email_snapshot DROP NOT NULL;
ALTER TABLE mail_recipients ALTER COLUMN invite_token_snapshot DROP NOT NULL;
ALTER TABLE mail_recipients DROP CONSTRAINT IF EXISTS mail_recipients_contact_target_id_fkey;
ALTER TABLE mail_recipients DROP CONSTRAINT IF EXISTS mail_recipients_contact_target_id_contact_targets_id_fk;
ALTER TABLE mail_recipients ADD CONSTRAINT mail_recipients_contact_target_id_contact_targets_id_fk
  FOREIGN KEY (contact_target_id) REFERENCES contact_targets(id) ON DELETE SET NULL;

DROP FUNCTION IF EXISTS next_contact_resid(uuid);
CREATE FUNCTION next_contact_resid(p_survey_id uuid, p_is_test boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT COALESCE(MAX(resid),0)+1 INTO v_next FROM contact_targets
   WHERE survey_id=p_survey_id AND is_test=p_is_test;
  RETURN v_next;
END;
$$;

DROP FUNCTION IF EXISTS next_campaign_run_number(uuid);
CREATE FUNCTION next_campaign_run_number(p_survey_id uuid, p_is_test boolean DEFAULT false)
RETURNS integer LANGUAGE plpgsql SECURITY INVOKER SET search_path = pg_catalog, public AS $$
DECLARE v_next integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(p_survey_id::text || ':' || p_is_test::text, 0));
  SELECT COALESCE(MAX(run_number),0)+1 INTO v_next FROM mail_campaigns
   WHERE survey_id=p_survey_id AND is_test=p_is_test;
  RETURN v_next;
END;
$$;

CREATE UNIQUE INDEX survey_responses_test_target_active_unique
  ON survey_responses(contact_target_id)
  WHERE is_test=true AND contact_target_id IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE test_response_attempts (
  id uuid PRIMARY KEY,
  response_id uuid NOT NULL REFERENCES survey_responses(id) ON DELETE CASCADE,
  session_id text NOT NULL,
  status text NOT NULL CHECK (status IN ('active','superseded')),
  started_at timestamptz NOT NULL DEFAULT now(),
  superseded_at timestamptz
);
CREATE UNIQUE INDEX test_response_attempts_active_response_unique
  ON test_response_attempts(response_id) WHERE status='active';
CREATE INDEX contact_targets_survey_scope_resid_idx ON contact_targets(survey_id,is_test,resid);
CREATE INDEX mail_campaigns_survey_scope_created_idx ON mail_campaigns(survey_id,is_test,created_at DESC) WHERE archived_at IS NULL;
CREATE INDEX mail_recipients_campaign_active_idx ON mail_recipients(campaign_id,status) WHERE archived_at IS NULL;

ALTER TABLE test_response_attempts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE test_response_attempts FROM anon, authenticated;

COMMIT;
