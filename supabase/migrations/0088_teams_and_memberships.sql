-- 0088: 팀 · 팀 멤버십 · 팀 수명주기 감사. (2026-08-26, 역할 모델 v2 티켓 06)
--
-- teams 는 설문 소유·접근의 최소 워크스페이스다(ADR-0006·0008). 이름에 전체 조직 경로를
-- 담지만(`연구1본부 - 1팀`) 권한 판정은 언제나 team_id 로 한다 — 이름이 같은 본부 경로를
-- 공유해도 팀끼리 자동 공유는 없다.
--
-- 「메가리서치」(시스템 전체 보기)는 팀이 아니므로 이 테이블에 행이 생기지 않는다(ADR-0006).
-- 슈퍼어드민의 가상 범위일 뿐이라 멤버십·설문 소유·해산 대상이 될 수 없다.
--
-- 해산은 행 삭제가 아니라 status='archived' 전환이다(ADR-0011). archived 팀의 멤버십 행은
-- 감사용으로 남기고 유효 소속 계산에서 뺀다 — 그래서 team_members 의 FK 는 restrict 다
-- (팀이 사라지지 않으니 cascade 할 일이 없고, 실수로 지우면 감사 계보가 끊긴다).
--
-- surveys.team_id 는 여기 없다 — 설문 귀속은 티켓 07 소관이라 그때 컬럼과 백필이 함께 온다.
-- 이 마이그레이션은 사용자 축(팀·멤버십)만 세운다.
--
-- RLS: 0035 하우스 룰 — 신규 public 테이블은 같은 마이그레이션에서 ENABLE (정책 0개 =
-- anon/authenticated deny-all, 앱은 BYPASSRLS 인 postgres 롤로만 접근).
-- 멱등 (IF NOT EXISTS) — 빈 DB 재생(pnpm db:setup-test)과 재적용 양쪽 안전.

BEGIN;

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  archived_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 이름은 표시용이지만 같은 이름의 활성 팀이 둘이면 화면에서 구분할 방법이 없다.
-- archived 팀은 목록에서 사라지므로 제약에서 뺀다 — 같은 이름으로 다시 만들 수 있어야 한다.
CREATE UNIQUE INDEX IF NOT EXISTS teams_active_name_uq
  ON teams (name) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS team_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'member')),
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 한 팀에 같은 사람이 두 번 들어가지 않는다. 서로 다른 팀에 동시 소속(겸직)은 허용이므로
-- user_id 단독 UNIQUE 는 두지 않는다 — 겸직 생성 권한은 서비스 레이어가 좁힌다.
CREATE UNIQUE INDEX IF NOT EXISTS team_members_team_user_uq
  ON team_members (team_id, user_id);
CREATE INDEX IF NOT EXISTS team_members_user_id_idx ON team_members (user_id);

-- 팀에 일어난 일의 감사 (append-only) — 팀 자체(create/rename/dissolve)와 멤버 구성
-- (member_add/member_role/member_remove)을 한 테이블에 남긴다. 제외는 team_members 행을
-- 지우므로, 이 행이 없으면 "누가 언제 누구를 뺐는가" 가 어디에도 남지 않는다.
CREATE TABLE IF NOT EXISTS team_lifecycle_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  action text NOT NULL CHECK (
    action IN ('create', 'rename', 'dissolve', 'member_add', 'member_role', 'member_remove')
  ),
  -- 멤버 사건의 대상. 팀 자체 사건에서는 NULL 이다.
  target_user_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  changed_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS team_lifecycle_events_team_idx
  ON team_lifecycle_events (team_id);

COMMENT ON TABLE team_lifecycle_events IS
  '팀 수명주기 + 멤버 구성 감사 (append-only). 제외는 멤버 행을 지우므로 흔적이 여기에만 남는다';
COMMENT ON TABLE teams IS
  '팀 — 설문 소유·접근 경계. 시스템 전체 보기(메가리서치)는 팀이 아니라 행이 없다 (ADR-0006)';
COMMENT ON TABLE team_members IS
  '팀 멤버십 — 소속의 단일 정본 (ADR-0008). archived 팀 행은 감사용 보존, 유효 소속 계산 제외';

ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE teams FROM anon, authenticated;
ALTER TABLE team_members ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE team_members FROM anon, authenticated;
ALTER TABLE team_lifecycle_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE team_lifecycle_events FROM anon, authenticated;

COMMIT;
