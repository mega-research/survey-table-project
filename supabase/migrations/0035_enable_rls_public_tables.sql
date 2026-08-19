-- 0035_enable_rls_public_tables.sql
-- 적용: 2026-06-13 Supabase MCP apply_migration 로 운영 DB 적용 (drizzle _journal.json 비대상 — 추적 기록).
--
-- public 스키마 테이블에 RLS 활성(deny-all)으로 정합. 이 앱은 데이터 접근을 전부
-- Drizzle(DATABASE_URL=postgres, BYPASSRLS) / service_role(BYPASSRLS)로만 하고 anon/authenticated
-- 롤로 테이블을 직접 쿼리하지 않으므로, 정책 없이 RLS 만 켜도 서버 경로는 정상 동작하고
-- anon/authenticated 는 deny 된다 (service-role 전용 앱의 표준 구성). FORCE 가 아니라 ENABLE 만
-- (postgres owner/BYPASSRLS 가 우회). contact_pii / contact_targets 는 이미 RLS-on 이라 제외.
--
-- 향후: 신규 public 테이블 추가 시 같은 마이그레이션에서 ENABLE ROW LEVEL SECURITY 를 함께 적용할 것.

ALTER TABLE public.surveys ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.survey_responses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.response_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.response_edit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_lookups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_cells ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contact_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_campaigns ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_recipients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mail_billing_periods ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_events ENABLE ROW LEVEL SECURITY;

-- 레거시 고아 테이블(mail_* 리팩토링 이전 email_*) — 미사용이나 일관성 위해 동일 적용.
-- 2026-08-19 재생 가능성 수선: 이 넷은 어떤 마이그레이션도 만들지 않아 빈 DB 재생 시
-- 존재하지 않는다. 존재할 때만 적용한다. 위 목록을 리터럴로 남겨둔 것은 RLS 게이트
-- (.github/rls-gate.ts)가 정규식으로 ENABLE ROW LEVEL SECURITY 를 읽기 때문이다 —
-- DO 블록으로 감싸면 게이트가 RLS 누락으로 오판한다.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_templates', 'email_attachments', 'email_campaigns', 'email_campaign_recipients']
  LOOP
    IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname='public' AND tablename=t) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    END IF;
  END LOOP;
END $$;
