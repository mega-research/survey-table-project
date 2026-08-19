-- 0078: contact/r2 테이블의 anon·authenticated 권한 회수. (2026-08-19)
--
-- 배경: pnpm db:drift 로 prod 와 staging 을 대조하다 발견했다. prod 는 0035~0037 로
-- 회수돼 있으나 staging 에는 contact_pii, contact_targets, r2_deletion_candidates,
-- r2_sent_keys 네 테이블에 anon·authenticated 권한이 남아 있었다. staging 은 2026-08-10
-- 백업 복원으로 만들어졌고 그 과정에서 ACL 이 supabase 기본값으로 되돌아간 것으로 보인다.
-- 같은 원인으로 lookup_contact_by_invite_token 의 EXECUTE 도 살아 있었고 0075 에서 회수했다.
--
-- 지금 즉시 노출은 아니다 — 네 테이블 모두 RLS 가 켜져 있고 정책이 0개라 PostgREST 경유
-- anon 접근은 차단된다. 다만 contact_pii 는 암호화 PII 를 담는 테이블이라 방어를 RLS 한 겹에
-- 의존시키지 않는다. 정책이 하나라도 추가되는 순간 전 권한이 살아나는 구조를 없앤다.
--
-- prod 는 이미 회수 상태라 이 파일은 no-op 이다. 환경 간 상태를 수렴시키는 것이 목적이다.
-- 테이블이 없는 환경에서도 안전하도록 존재를 확인하고 회수한다.

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['contact_pii','contact_targets','r2_deletion_candidates','r2_sent_keys']
  LOOP
    IF EXISTS (
      SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = t
    ) THEN
      EXECUTE format('REVOKE ALL ON TABLE public.%I FROM anon, authenticated', t);
    END IF;
  END LOOP;
END $$;
