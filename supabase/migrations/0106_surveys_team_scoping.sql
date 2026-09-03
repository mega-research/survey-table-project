-- 0106: 설문 팀 귀속 — surveys 소유·배치 컬럼 7종 + 기존 설문 배치 대기 백필.
--       (2026-08-26, 역할 모델 v2 티켓 07)
--
-- 0105 이 사람 축(팀·멤버십)을 세웠고 여기서 설문이 그 축에 붙는다. 팀원은 자기 팀 설문만
-- 보고 만들며, 판정은 언제나 team_id 로 한다(ADR-0006·0008).
--
-- 백필은 가짜 기본 팀을 만들지 않는다. 팀 도입 이전 설문 전부를 team_id NULL +
-- assignment_status='assignment_pending' 으로 세우고 소유자만 최초 active 슈퍼어드민으로
-- 지정한다 — 그 상태의 설문은 슈퍼어드민 외 내부 접근이 막히고, 재배치 센터(티켓 14)가
-- 팀을 정해줄 때까지 대기한다. 공개 응답·메일 경로는 이 컬럼들을 보지 않으므로 계속 돈다.
--
-- owner_user_id·created_by 는 **앱이 채우는 값이라 NOT NULL 을 지금 걸지 않는다**
-- (CLAUDE.md 주의사항 8, 2단계 배포). 이 마이그레이션은 nullable 추가 + 백필까지고,
-- SET NOT NULL 은 앱 배포 후 별도 마이그레이션이다(티켓 29 배포 체크리스트).
-- 지금 걸면 구버전 앱의 설문 INSERT 가 그 순간 깨진다.
--
-- assignment_status 의 DEFAULT 가 'assigned' 가 아니라 'assignment_pending' 인 것도 같은
-- 이유다 — 아무것도 안 넣는 구버전 앱의 INSERT 가 CHECK(assigned ↔ team_id NOT NULL)에
-- 걸려 실패하지 않게 한다. 신규 앱은 두 값을 언제나 함께 명시한다.
--
-- survey_group_id 는 컬럼만 둔다. survey_groups 테이블은 티켓 12 소관이라 FK 도 그때 붙는다.
--
-- RLS: surveys 는 기존 테이블이라 이미 ENABLE 되어 있다 — 신규 테이블이 없어 추가 조치 없음.
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생(pnpm db:setup-test)과 재적용 양쪽 안전.

BEGIN;

ALTER TABLE surveys ADD COLUMN IF NOT EXISTS team_id uuid;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'team';
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS owner_user_id uuid;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS created_by uuid;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS survey_group_id uuid;
ALTER TABLE surveys ADD COLUMN IF NOT EXISTS ownership_status text NOT NULL DEFAULT 'normal';
ALTER TABLE surveys
  ADD COLUMN IF NOT EXISTS assignment_status text NOT NULL DEFAULT 'assignment_pending';

-- 백필 — 소유자를 최초 active 슈퍼어드민으로 채운다.
--
-- 배치 상태는 손대지 않는다. 위에서 추가한 컬럼의 DEFAULT 가 이미 assignment_pending 이고
-- team_id 는 NULL 이라 기존 설문 전부가 그 상태로 들어와 있다 — 여기서 다시 SET 하면
-- **재적용 시 정상 배치된 설문까지 배치 대기로 되돌린다**. 백필이 실제로 해야 하는 일은
-- 소유자 하나뿐이고, 그래서 조건도 소유자 미지정 행으로 좁힌다(재적용 안전).
--
-- 슈퍼어드민이 아직 없으면 owner_user_id 는 NULL 로 남는다(빈 DB 재생이 그렇다). 그 경우도
-- assignment_pending 이라 슈퍼어드민 외에는 접근할 수 없어 열린 문이 되지 않는다.
UPDATE surveys
SET owner_user_id = (
  SELECT id FROM users
  WHERE is_superadmin = true AND status = 'active'
  ORDER BY created_at ASC
  LIMIT 1
)
WHERE owner_user_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surveys_team_id_teams_id_fk'
  ) THEN
    ALTER TABLE surveys ADD CONSTRAINT surveys_team_id_teams_id_fk
      FOREIGN KEY (team_id) REFERENCES teams (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surveys_owner_user_id_users_id_fk'
  ) THEN
    ALTER TABLE surveys ADD CONSTRAINT surveys_owner_user_id_users_id_fk
      FOREIGN KEY (owner_user_id) REFERENCES users (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surveys_created_by_users_id_fk'
  ) THEN
    ALTER TABLE surveys ADD CONSTRAINT surveys_created_by_users_id_fk
      FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT;
  END IF;

  -- 어휘 CHECK — shared/contracts/workspace.ts 의 값 목록과 같아야 한다.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surveys_visibility_check'
  ) THEN
    ALTER TABLE surveys ADD CONSTRAINT surveys_visibility_check
      CHECK (visibility IN ('team', 'invite_only'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surveys_ownership_status_check'
  ) THEN
    ALTER TABLE surveys ADD CONSTRAINT surveys_ownership_status_check
      CHECK (ownership_status IN ('normal', 'succession_pending'));
  END IF;

  -- 배치 상태와 팀은 한 몸이다 — 한쪽만 바꾸는 쓰기를 DB 가 거부한다. 어휘 CHECK 를 겸한다.
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surveys_assignment_check'
  ) THEN
    ALTER TABLE surveys ADD CONSTRAINT surveys_assignment_check
      CHECK (
        (assignment_status = 'assigned' AND team_id IS NOT NULL)
        OR (assignment_status = 'assignment_pending' AND team_id IS NULL)
      );
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS surveys_team_id_idx ON surveys (team_id);
CREATE INDEX IF NOT EXISTS surveys_owner_user_id_idx ON surveys (owner_user_id);

COMMENT ON COLUMN surveys.assignment_status IS
  '팀 배치 상태. assignment_pending 은 team_id NULL 과 한 몸이며 슈퍼어드민 외 접근 불가 (ADR-0006)';
COMMENT ON COLUMN surveys.visibility IS
  'team | invite_only. invite_only 는 소유 팀 팀원에게만 숨김 — 팀장·소유자·참여자는 팀 공개와 동일';
COMMENT ON COLUMN surveys.owner_user_id IS
  '설문 소유자. 2단계 배포 중이라 아직 nullable — SET NOT NULL 은 앱 배포 후(티켓 29)';

COMMIT;
