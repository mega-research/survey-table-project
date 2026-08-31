-- 0093: 실사 업체 + 실사 계정의 소속·역할. (2026-08-31, 역할 모델 v2 티켓 24)
--
-- 업체는 **워크스페이스가 아니다**(ADR-0019). 설문을 소유하지 않고(`surveys.team_id` 는 이
-- 테이블을 가리키지 않는다) 팀 멤버십을 만들지 않으며 재배치 목적지가 될 수 없다. 이름·상태만
-- 갖는 가벼운 경계 엔티티이고, 하는 일은 「이 실사 계정이 어느 업체 사람인가」 하나뿐이다.
-- 그 경계가 없으면 실사 팀장의 파생 시야(티켓 25)가 타 업체 설문까지 넘친다.
--
-- 종료는 팀 해산과 같은 판단이다 — 행을 지우지 않고 archived 로 내린다. 소속 계정이 계보로
-- 남아 있어야 「누가 어느 업체 사람이었는가」를 되짚을 수 있다. 활성 이름만 부분 UNIQUE 인
-- 것도 teams 와 같다(archived 이름은 다시 쓸 수 있다).
--
-- users 의 두 컬럼과 user_type 의 정합은 **CHECK 가 지킨다** — 한 행 안의 조건이라 걸 수 있다
-- (`survey_participants.kind` 는 두 테이블에 걸쳐 있어 못 걸었다, 0092 헤더 참조). 티켓의
-- 「업체 없는 실사 계정 생성 거부」가 이 제약이고, 서비스 검증은 그 앞의 그물이다.
--
-- **CHECK 를 지금 그냥 걸어도 되는 이유**: user_type='fieldwork' 행이 아직 하나도 없다.
-- `CreateUserInput` 유니온에 실사 variant 가 없어(티켓 03 이 의도적으로 뺐다) 발급 경로가
-- 존재한 적이 없기 때문이다. 구버전 앱의 INSERT 도 두 컬럼을 채우지 않아 NULL → 두 번째
-- 가지를 통과한다(주의사항 8 의 2단계 배포는 NOT NULL 컬럼 이야기라 여기 해당 없음).
--
-- FK 방향.
--  - fieldwork_orgs.created_by·archived_by RESTRICT : 사람은 하드 삭제되지 않는다.
--  - users.fieldwork_org_id RESTRICT : 소속 계정이 있는 업체는 지울 수 없다. 애초에 앱에
--    업체 하드 삭제 경로가 없지만(archive 뿐), 제약이 없으면 DB 직접 조작 한 번에 소속을
--    잃은 실사 계정이 남고 그 계정은 CHECK 위반 상태가 된다.
--
-- drizzle 쪽 `users.fieldworkOrgId` 에는 `.references()` 가 없다 — fieldwork_orgs 는
-- schema/workspace.ts 에 있고 그 파일이 schema/auth.ts 의 users 를 쓰므로 순환이 된다.
-- FK 는 여기 ALTER 가 만든다(`survey_responses.contact_target_id` 와 같은 선례).
--
-- RLS: 0035 하우스 룰 — 신규 public 테이블은 같은 마이그레이션에서 ENABLE (정책 0개 =
-- anon/authenticated deny-all, 앱은 BYPASSRLS 인 postgres 롤로만 접근).
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생(pnpm db:setup-test)과 재적용 양쪽 안전.

BEGIN;

CREATE TABLE IF NOT EXISTS fieldwork_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active',
  memo text,
  archived_by uuid REFERENCES users (id) ON DELETE RESTRICT,
  archived_at timestamptz,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'fieldwork_orgs_status_check'
  ) THEN
    ALTER TABLE fieldwork_orgs ADD CONSTRAINT fieldwork_orgs_status_check
      CHECK (status IN ('active', 'archived'));
  END IF;
END $$;

-- 활성 업체 이름만 유일하다 — archived 이름은 다시 쓸 수 있다(teams_active_name_uq 와 같은 관례).
CREATE UNIQUE INDEX IF NOT EXISTS fieldwork_orgs_active_name_uq
  ON fieldwork_orgs (name) WHERE status = 'active';

COMMENT ON TABLE fieldwork_orgs IS
  '실사 업체 — 외주 실사 인력의 소속 경계. 워크스페이스가 아니다: 설문 소유·팀 멤버십·재배치 목적지가 될 수 없다 (ADR-0019, 역할 모델 v2 티켓 24)';

ALTER TABLE fieldwork_orgs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE fieldwork_orgs FROM anon, authenticated;

-- ─────────────────────────────────────────────────────────────────────────────
-- users — 소속 업체 + 업체 내 역할
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE users ADD COLUMN IF NOT EXISTS fieldwork_org_id uuid;
ALTER TABLE users ADD COLUMN IF NOT EXISTS fieldwork_role text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_fieldwork_org_id_fkey'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_fieldwork_org_id_fkey
      FOREIGN KEY (fieldwork_org_id) REFERENCES fieldwork_orgs (id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 정합: 실사면 소속·역할이 둘 다 있어야 하고, 실사가 아니면 둘 다 없어야 한다.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'users_fieldwork_fields_check'
  ) THEN
    ALTER TABLE users ADD CONSTRAINT users_fieldwork_fields_check CHECK (
      (
        user_type = 'fieldwork'
        AND fieldwork_org_id IS NOT NULL
        AND fieldwork_role IN ('leader', 'worker')
      )
      OR (
        user_type <> 'fieldwork'
        AND fieldwork_org_id IS NULL
        AND fieldwork_role IS NULL
      )
    );
  END IF;
END $$;

-- 업체 카드가 소속 계정 목록을 그린다(.pen FLOW 10-4) — 이 인덱스가 그 방향을 받는다.
CREATE INDEX IF NOT EXISTS users_fieldwork_org_idx
  ON users (fieldwork_org_id) WHERE fieldwork_org_id IS NOT NULL;

COMMENT ON COLUMN users.fieldwork_org_id IS
  '소속 실사 업체 — fieldwork 전용. user_type 과의 정합은 users_fieldwork_fields_check 가 지킨다 (티켓 24)';
COMMENT ON COLUMN users.fieldwork_role IS
  'leader|worker — 업체 내 역할. 팀 역할(team_members.role)과 별개 축이다 (티켓 24)';

COMMIT;
