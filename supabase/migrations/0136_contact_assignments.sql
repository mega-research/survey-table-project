-- 0136: 컨택원 배정 — 조사 대상을 이름 붙은 묶음(컨택원)에 나눠 맡긴다. (2026-10-19)
--
-- 컨택원은 계정이 아니라 「10차」 「외주 A팀」 같은 이름 붙은 배정 묶음이다. 실데이터와
-- 테스트 데이터에 따로 있고(is_test, mail_campaigns 관례), 같은 설문·파티션 안에서 이름이
-- 겹치지 않는다. 한 조사 대상은 지금 컨택원 하나에만 속한다(contact_targets.assignment_id).
-- 컨택원을 지우면 대상은 배정 없음이 된다(ON DELETE SET NULL).
--
-- last_clauses 는 마지막으로 교체 적용한 조건({ source, value, op }[] — 조사 대상 필터 URL 의
-- col/q/op 와 같은 모양)이다. 접근은 서버(service role) 전용 — RLS 활성 + anon/authenticated
-- 권한 회수(0084 와 같은 규칙).
--
-- 0133·0134 는 staging 브랜치(외주 링크·클라이언트 링크)가 쓰고 있다.

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  is_test boolean NOT NULL DEFAULT false,
  name text NOT NULL CHECK (length(btrim(name)) > 0),
  "order" integer NOT NULL DEFAULT 0,
  last_clauses jsonb,
  last_applied_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_assignments_survey_scope_name_unique UNIQUE (survey_id, is_test, name)
);

ALTER TABLE public.contact_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_assignments FROM anon, authenticated;

ALTER TABLE public.contact_targets
  ADD COLUMN IF NOT EXISTS assignment_id uuid
    REFERENCES public.contact_assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS contact_targets_assignment_idx
  ON public.contact_targets (assignment_id)
  WHERE assignment_id IS NOT NULL;

COMMIT;
