-- 0121: 컨택 작성자 FK 를 앱 users 로 되돌린다. (2026-08-31, 역할 모델 v2 티켓 26)
--
-- `contact_attempts.created_by` 와 `contact_uploads.uploaded_by` 가 아직 **`auth.users`**
-- (Supabase Auth 테이블)를 가리키고 있었다. 앱의 계정은 티켓 01·02 에서 Better Auth 의
-- `public.users` 로 옮겨졌으므로, 두 컬럼은 그 뒤로 **채울 수 없는 상태**였다 — 값을 넣으면
-- 곧바로 FK 위반이다. 실제로 `addAttempt` 는 이 컬럼을 아예 쓰지 않고 있었다.
--
-- 티켓 26 이 그것을 드러냈다: 실사가 결과코드를 남기기 시작하면 담당 연구원이 「이 부재중은
-- 누가 찍었나」를 물을 수 있어야 하는데, 컬럼이 있는데도 못 채우는 상태였다.
--
-- **두 컬럼을 함께 고친다.** `uploaded_by` 는 오늘 쓰는 경로가 없지만 같은 결함이고, 하나만
-- 고쳐 두면 다음에 업로더를 기록하려는 사람이 같은 벽을 다시 만난다.
--
-- **기존 값이 없어 안전하다** — 로컬·스테이징 양쪽에서 두 컬럼 모두 NOT NULL 행이 0건이다
-- (채울 수 있는 경로가 없었으니 당연하다). 그래서 NOT VALID 없이 바로 건다.
--
-- RESTRICT 인 이유는 형제 감사 컬럼들과 같다(`survey_participants.added_by`,
-- `fieldwork_orgs.created_by`) — 사람은 하드 삭제되지 않고(퇴사는 status 전이다), 실수로
-- 지우면 「누가 남겼는가」가 끊긴다.
--
-- 멱등 (DO 블록) — 빈 DB 재생(pnpm db:setup-test)과 재적용 양쪽 안전.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_attempts_created_by_fkey' AND conrelid = 'contact_attempts'::regclass
  ) THEN
    ALTER TABLE contact_attempts DROP CONSTRAINT contact_attempts_created_by_fkey;
  END IF;

  ALTER TABLE contact_attempts ADD CONSTRAINT contact_attempts_created_by_fkey
    FOREIGN KEY (created_by) REFERENCES public.users (id) ON DELETE RESTRICT;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'contact_uploads_uploaded_by_fkey' AND conrelid = 'contact_uploads'::regclass
  ) THEN
    ALTER TABLE contact_uploads DROP CONSTRAINT contact_uploads_uploaded_by_fkey;
  END IF;

  ALTER TABLE contact_uploads ADD CONSTRAINT contact_uploads_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES public.users (id) ON DELETE RESTRICT;
END $$;

COMMENT ON COLUMN contact_attempts.created_by IS
  '이 회차를 남긴 계정 (public.users). 실사·담당 연구원 공용 — 티켓 26 이 채우기 시작했다';
COMMENT ON COLUMN contact_uploads.uploaded_by IS
  '업로드한 계정 (public.users). 채우는 경로는 아직 없다 — FK 만 앱 users 로 맞춰 둔다';

COMMIT;
