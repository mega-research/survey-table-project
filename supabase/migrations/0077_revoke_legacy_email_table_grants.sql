-- 0077: 레거시 email_* 테이블의 anon·authenticated 권한 회수. (2026-08-19)
--
-- 배경: mail_* 로 대체돼 앱이 더는 쓰지 않는 email_templates, email_attachments,
-- email_campaigns, email_campaign_recipients 네 테이블에 anon·authenticated 의
-- arwdDxtm 전 권한이 남아 있었다. 0037 이 기본 권한을 조일 때 누락된 분으로 보인다.
-- 같은 시기 Better Auth 계열 테이블은 권한이 회수돼 있다.
--
-- 현재 실제 노출은 아니다 — 네 테이블 모두 RLS 가 켜져 있고 정책이 0개라 PostgREST
-- 경유 anon 접근은 전부 차단된다. 다만 방어가 RLS 한 겹뿐이라, 누군가 정책을 하나라도
-- 추가하는 순간 전 권한이 살아난다. 두 겹으로 되돌린다.
--
-- 2026-08-19 프로덕션 실측 — 네 테이블 전부 0행. 데이터는 없으므로 최종적으로는 DROP 이
-- 맞으나, 파괴적 작업이라 별도 결정으로 남긴다.
--
-- 존재하지 않는 환경에서도 안전하도록 테이블 존재를 확인하고 회수한다.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['email_templates','email_attachments','email_campaigns','email_campaign_recipients']
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
