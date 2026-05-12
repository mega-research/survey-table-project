-- Migration: 0020_mail_campaigns
-- Purpose: 단체 메일 발송 슬라이스
--   T1: mail_campaigns — 회차별 발송 + 카운터 캐시 (group by 회피용 컬럼)
--   T2: mail_recipients — 수신자별 status + Resend message id 매핑
--   T3: webhook_events — Resend webhook idempotency (svix-id PK dedupe)
--   F1: next_campaign_run_number(survey_id) — survey-scoped 회차 자동 발번 (next_contact_resid 패턴 미러)
--   F2: reconcile_campaign_counters(campaign_id) — recipients group by → campaigns 카운터 동기화 (admin 복구용)
--
-- 카운터 갱신은 애플리케이션 측 atomic UPDATE 로 처리 (트리거 미사용).
-- finalize 판정은 webhook handler 가 즉시 처리 (queued+sent==0 도달 시) + 누락 보강은 pg_cron (하단 주석 참조).

BEGIN;

-- T1: mail_campaigns
CREATE TABLE "mail_campaigns" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "survey_id" uuid NOT NULL REFERENCES "surveys"("id") ON DELETE CASCADE,
  "mail_template_id" uuid REFERENCES "mail_templates"("id") ON DELETE SET NULL,
  "run_number" integer NOT NULL,
  "title" text NOT NULL,

  -- 발송 시점 스냅샷 (템플릿 사후 수정 영향 차단)
  "subject_snapshot" text NOT NULL,
  "body_html_snapshot" text NOT NULL,
  "from_local_snapshot" text NOT NULL,
  "from_name_snapshot" text NOT NULL,
  "reply_to_snapshot" text,
  "attachments_snapshot" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "filter_snapshot" jsonb NOT NULL DEFAULT '{}'::jsonb,

  "created_by" uuid,
  "status" text NOT NULL DEFAULT 'draft'
    CHECK ("status" IN ('draft','queued','sending','completed','partial','cancelled')),

  -- 카운터 캐시 (mail_recipients.status 별 합계 — webhook handler 가 atomic delta 로 갱신)
  "recipient_count" integer NOT NULL DEFAULT 0,
  "queued_count" integer NOT NULL DEFAULT 0,
  "sent_count" integer NOT NULL DEFAULT 0,
  "delivered_count" integer NOT NULL DEFAULT 0,
  "opened_count" integer NOT NULL DEFAULT 0,
  "bounced_count" integer NOT NULL DEFAULT 0,
  "complained_count" integer NOT NULL DEFAULT 0,
  "failed_count" integer NOT NULL DEFAULT 0,
  "skipped_unsubscribed_count" integer NOT NULL DEFAULT 0,

  "scheduled_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "mail_campaigns_survey_run_unique" UNIQUE ("survey_id", "run_number")
);

CREATE INDEX "mail_campaigns_survey_created_idx"
  ON "mail_campaigns" ("survey_id", "created_at" DESC);

-- T2: mail_recipients
CREATE TABLE "mail_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "campaign_id" uuid NOT NULL REFERENCES "mail_campaigns"("id") ON DELETE CASCADE,
  "contact_target_id" uuid NOT NULL REFERENCES "contact_targets"("id") ON DELETE CASCADE,
  "email_snapshot" text NOT NULL,
  "invite_token_snapshot" uuid NOT NULL,

  "status" text NOT NULL DEFAULT 'queued'
    CHECK ("status" IN ('queued','sending','sent','delivered','opened',
                        'bounced','complained','failed','skipped_unsubscribed')),
  "resend_message_id" text,
  "error_reason" text,

  "sent_at" timestamp with time zone,
  "delivered_at" timestamp with time zone,
  "opened_at" timestamp with time zone,
  "bounced_at" timestamp with time zone,
  "complained_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),

  CONSTRAINT "mail_recipients_campaign_contact_unique"
    UNIQUE ("campaign_id", "contact_target_id")
);

-- 동일 캠페인 내 컨택 중복 차단 (UNIQUE) + webhook 매칭 키 unique
CREATE UNIQUE INDEX "mail_recipients_resend_msg_idx"
  ON "mail_recipients" ("resend_message_id")
  WHERE "resend_message_id" IS NOT NULL;

CREATE INDEX "mail_recipients_campaign_status_idx"
  ON "mail_recipients" ("campaign_id", "status");

-- T3: webhook_events — Resend webhook idempotency dedupe.
--     PK 는 svix-id (Resend webhook header). 동일 svix-id 재전송 시 ON CONFLICT 로 skip.
CREATE TABLE "webhook_events" (
  "id" text PRIMARY KEY,
  "source" text NOT NULL DEFAULT 'resend',
  "event_type" text,
  "received_at" timestamp with time zone NOT NULL DEFAULT now()
);

-- F1: next_campaign_run_number — survey-scoped sequence.
--     advisory lock + search_path 하드닝 (next_contact_resid 패턴 미러).
CREATE OR REPLACE FUNCTION next_campaign_run_number(p_survey_id uuid) RETURNS integer AS $$
DECLARE
  next_id integer;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('campaign_run:' || p_survey_id::text));
  SELECT COALESCE(MAX(run_number), 0) + 1 INTO next_id
    FROM public.mail_campaigns WHERE survey_id = p_survey_id;
  RETURN next_id;
END;
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog, public;

-- F2: reconcile_campaign_counters — recipients group by 결과로 campaigns 카운터 동기화.
--     운영 중 카운터 표류 발생 시 수동 호출 (admin 복구 도구).
CREATE OR REPLACE FUNCTION reconcile_campaign_counters(p_campaign_id uuid) RETURNS void AS $$
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
$$ LANGUAGE plpgsql
   SET search_path = pg_catalog, public;

COMMIT;

-- ─────────────────────────────────────────────────────────────────────────────
-- pg_cron 보강 (별도 적용 — superuser 권한 필요. Supabase dashboard SQL editor 에서 실행 권장)
-- 목적: webhook 누락으로 status='sending' 인 채 24h 경과한 캠페인 강제 finalize.
-- 적용 전 Supabase Dashboard > Database > Extensions 에서 pg_cron enable.
--
-- BEGIN;
-- SELECT cron.schedule(
--   'finalize-stuck-campaigns',
--   '0 3 * * *',  -- 매일 03:00 KST
--   $$
--     UPDATE public.mail_campaigns
--     SET status = CASE WHEN bounced_count + failed_count > 0 THEN 'partial' ELSE 'completed' END,
--         completed_at = now(),
--         updated_at = now()
--     WHERE status = 'sending'
--       AND started_at < now() - interval '24 hours';
--   $$
-- );
-- COMMIT;
--
-- 해제: SELECT cron.unschedule('finalize-stuck-campaigns');
-- ─────────────────────────────────────────────────────────────────────────────

-- ROLLBACK SQL (수동 적용용 — 본 마이그레이션 실패 시):
-- BEGIN;
-- DROP FUNCTION IF EXISTS reconcile_campaign_counters(uuid);
-- DROP FUNCTION IF EXISTS next_campaign_run_number(uuid);
-- DROP TABLE IF EXISTS webhook_events;
-- DROP INDEX IF EXISTS mail_recipients_campaign_status_idx;
-- DROP INDEX IF EXISTS mail_recipients_resend_msg_idx;
-- DROP TABLE IF EXISTS mail_recipients;
-- DROP INDEX IF EXISTS mail_campaigns_survey_created_idx;
-- DROP TABLE IF EXISTS mail_campaigns;
-- COMMIT;
