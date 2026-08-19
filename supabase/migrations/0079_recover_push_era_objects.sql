-- 0079: push 시대에 파일 없이 프로덕션에 들어온 객체들을 레포로 복구한다. (2026-08-19)
--
-- pnpm db:drift 로 찾아낸 것들이다. 전부 프로덕션에 실재하지만 어떤 마이그레이션도 만들지
-- 않아, 빈 DB 를 마이그레이션으로 재생하면 프로덕션과 다른 DB 가 나왔다. 정의는 2026-08-19
-- 프로덕션 조회(information_schema, pg_get_functiondef)에서 그대로 옮겼다.
--
-- 이 파일은 "복구"이지 "정리"가 아니다. 아래 중 일부는 사용되지 않아 DROP 이 맞을 수 있으나,
-- 그 판단은 값의 의미 확인이 선행돼야 하므로 분리한다 (drift-allowlist.json 의 미결 항목 참조).
--   - surveys.user_id            11행 중 4행에 값 있음. 코드·정책 참조 없음
--   - surveys.email_settings     값 0행. 레거시 email 시대 잔재
--   - contact_attempts.campaign_id  값 0행. 사용된 적 없음
--   - contact_attempts.attempt_source  767행 전부 'manual'. 앱 미사용이나 NOT NULL DEFAULT
--
-- survey_responses.deleted_at 는 여기가 아니라 0004 에서 복구했다 — 0026 이하가 그 컬럼을
-- 참조하므로 체인 앞쪽에 있어야 했다.
--
-- 전부 IF NOT EXISTS / CREATE OR REPLACE 라 이미 같은 상태인 DB 에는 무해하다.

BEGIN;

-- 컨택 시도 출처 enum. contact_attempts.attempt_source 가 이 타입 위에 선다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public' AND t.typname = 'contact_attempt_source'
  ) THEN
    CREATE TYPE public.contact_attempt_source AS ENUM ('manual', 'email', 'unsubscribe');
  END IF;
END $$;

ALTER TABLE contact_attempts
  ADD COLUMN IF NOT EXISTS attempt_source public.contact_attempt_source NOT NULL DEFAULT 'manual';
ALTER TABLE contact_attempts
  ADD COLUMN IF NOT EXISTS campaign_id uuid;

ALTER TABLE surveys ADD COLUMN IF NOT EXISTS user_id uuid;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS email_settings jsonb;

-- 캠페인 카운터 재계산. webhook 누락 시 보강 경로로 쓰인다.
CREATE OR REPLACE FUNCTION public.reconcile_campaign_counters(p_campaign_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SET search_path TO 'pg_catalog', 'public'
AS $function$
BEGIN
  UPDATE public.mail_campaigns mc
  SET
    recipient_count = COALESCE(s.total, 0),
    queued_count = COALESCE(s.queued, 0),
    sent_count = COALESCE(s.sent, 0),
    delivered_count = COALESCE(s.delivered, 0),
    opened_count = COALESCE(s.opened, 0),
    bounced_count = COALESCE(s.bounced, 0),
    complained_count = COALESCE(s.complained, 0),
    failed_count = COALESCE(s.failed, 0),
    skipped_unsubscribed_count = COALESCE(s.skipped, 0),
    updated_at = now()
  FROM (
    SELECT
      COUNT(*)::int AS total,
      COUNT(*) FILTER (WHERE status = 'queued')::int AS queued,
      COUNT(*) FILTER (WHERE status IN ('sending','sent'))::int AS sent,
      COUNT(*) FILTER (WHERE status = 'delivered')::int AS delivered,
      COUNT(*) FILTER (WHERE status = 'opened')::int AS opened,
      COUNT(*) FILTER (WHERE status = 'bounced')::int AS bounced,
      COUNT(*) FILTER (WHERE status = 'complained')::int AS complained,
      COUNT(*) FILTER (WHERE status = 'failed')::int AS failed,
      COUNT(*) FILTER (WHERE status = 'skipped_unsubscribed')::int AS skipped
    FROM public.mail_recipients
    WHERE campaign_id = p_campaign_id
  ) s
  WHERE mc.id = p_campaign_id;
END;
$function$;

-- 이력과 프로덕션 실제 상태가 갈린 두 컬럼의 최종 상태 보정.
--
-- questions.allow_other_option: 0000 이 만들고 0023 이 지웠으나, drizzle 스키마가 계속
--   선언하고 있어 이후 push 때 프로덕션에 되살아났다. 앱이 실제로 쓰는 컬럼이므로 되살린 쪽이
--   맞는 상태다. 0023 의 DROP 은 되돌리지 않고 여기서 다시 만든다.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS allow_other_option boolean DEFAULT false;

-- survey_responses.ip_address: 0000 이 만들었고 어떤 마이그레이션도 지우지 않았으나,
--   프로덕션에는 없다. 스키마가 ip_hash 로 옮겨간 뒤 push 가 지운 것이다. 원문 IP 를 남기지
--   않는 것이 현재 정책이므로 프로덕션 상태에 맞춘다.
ALTER TABLE survey_responses DROP COLUMN IF EXISTS ip_address;

COMMIT;
