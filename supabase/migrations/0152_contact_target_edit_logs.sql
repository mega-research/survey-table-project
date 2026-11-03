-- 0152: 대상 정보 수정 현황 — 조사 대상 한 명의 정보·회차·컨택원을 손으로 바꾼 기록. (2026-11-03)
--
-- 운영 콘솔 조사 대상 상세에서 명단 값·메모·컨택 방법·컨택원을 바꾸거나 컨택 결과 회차를 고치거나
-- 지워도 그동안 아무것도 남지 않았다(.scratch/contact-edit-history/PRD.md). 바꾼 쓰기와 같은
-- 트랜잭션에서 이 표에 한 줄을 넣는다. changes 는 변경 목록(JSONB) — 열 이름·컨택원 이름은 그때
-- 스냅샷이고, 개인정보 열은 값 없이 「입력·변경·삭제」만 담는다(파기 스윕 대상이 아니다).
-- 파티션 열은 두지 않는다 — 대상이 이미 실/테스트에 속하고 읽기는 대상 단위다.
-- 대상·설문이 지워지면 함께 지워진다(ON DELETE CASCADE).
--
-- contact_attempts.created_by_email — 회차 기록자 이메일 스냅샷. created_by 와 함께 채운다.
-- 기존 행은 둘 다 NULL 로 둔다(백필하지 않는다).
--
-- contact_attempts.created_by → auth.users(id) FK 를 ON DELETE SET NULL 로 다시 건다. 0014 가 이름 없이
-- 기본 동작(NO ACTION)으로 만들어, 회차에 기록자 id 를 채우기 시작하면 회차를 남긴 계정을 지울 수
-- 없게 된다. 누구였는지는 created_by_email 이 남긴다. 제약 이름은 pg_constraint 에서 찾아 지운다 —
-- 빈 DB 재생(기본 이름 contact_attempts_created_by_fkey)과 실 DB 양쪽에서 같은 결과가 되게.
-- 이미 SET NULL 이면 손대지 않는다(다시 적용해도 안전하다).
--
-- 앱 배포 전에 적용한다 — 새 앱이 쓴다. 새 표·nullable 열이라 구버전 앱에 영향이 없어 단일 단계다.
-- 접근은 서버(service role) 전용 — RLS 활성 + anon/authenticated 권한 회수(0136·0142 관례).

BEGIN;

CREATE TABLE IF NOT EXISTS public.contact_target_edit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES public.surveys(id) ON DELETE CASCADE,
  contact_target_id uuid NOT NULL REFERENCES public.contact_targets(id) ON DELETE CASCADE,
  action text NOT NULL,
  changes jsonb NOT NULL,
  edited_by text,
  editor_email text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contact_target_edit_logs_action_check
    CHECK (action IN ('info_edit', 'attempt_edit', 'attempt_delete', 'assignment_change'))
);

ALTER TABLE public.contact_target_edit_logs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.contact_target_edit_logs FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS contact_target_edit_logs_target_created_idx
  ON public.contact_target_edit_logs (contact_target_id, created_at DESC);

ALTER TABLE public.contact_attempts ADD COLUMN IF NOT EXISTS created_by_email text;

DO $$
DECLARE
  fk record;
BEGIN
  IF EXISTS (
    SELECT 1
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.contact_attempts'::regclass
      AND c.confrelid = 'auth.users'::regclass
      AND a.attname = 'created_by'
      AND c.confdeltype = 'n'
  ) THEN
    RETURN;
  END IF;

  FOR fk IN
    SELECT c.conname
    FROM pg_constraint c
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = ANY (c.conkey)
    WHERE c.contype = 'f'
      AND c.conrelid = 'public.contact_attempts'::regclass
      AND c.confrelid = 'auth.users'::regclass
      AND a.attname = 'created_by'
  LOOP
    EXECUTE format('ALTER TABLE public.contact_attempts DROP CONSTRAINT %I', fk.conname);
  END LOOP;

  ALTER TABLE public.contact_attempts
    ADD CONSTRAINT contact_attempts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES auth.users(id) ON DELETE SET NULL;
END $$;

COMMIT;
