-- 0117: 팀 공용 설문 그룹. (2026-08-27, 역할 모델 v2 티켓 12)
--
-- 그룹은 **접근 권한이 아니라 정리용 묶음**이다 — 팀이 소유하고 모든 active 팀원이 구조를
-- 편집하며, 그룹에 담겼다는 사실이 설문을 누가 볼 수 있는지에 아무 영향을 주지 않는다.
-- 접근 판정은 계속 surveys.team_id·visibility·owner_user_id 로만 한다(ADR-0006·0008).
--
-- 0116 가 surveys.survey_group_id 컬럼만 미리 세워뒀고 여기서 테이블과 FK 가 붙는다.
--
-- FK 는 ON DELETE SET NULL 이다 — 그룹 삭제는 설문을 지우는 일이 아니라 미분류로 되돌리는
-- 일이라서다(.pen FLOW 2-3). RESTRICT 로 두면 "설문이 들어 있어 그룹을 못 지운다" 가 되어
-- 화면의 「그룹만 삭제되고 설문은 삭제되지 않습니다」 약속과 어긋난다.
--
-- team_id 는 RESTRICT — 팀은 해산해도 행이 남으므로(status='archived', ADR-0011) 삭제될 일이
-- 없고, 실수로 지우면 그룹 계보가 끊긴다.
--
-- **설문이 팀을 옮기면 그룹은 미분류가 되어야 한다**(그룹은 팀 소유물이다). 그 전이를 만드는
-- 흐름은 팀 해산(티켓 13)·재배치(14)·소유권 승계(19)이며 아직 없다. 여기서 복합 FK 로
-- 강제하지 않은 이유: (survey_group_id, team_id) 복합 FK 는 MATCH SIMPLE 이면 team_id 가
-- NULL 인 순간(해산이 바로 그 경우다) 검사를 건너뛰고, MATCH FULL 이면 "팀은 있고 그룹은
-- 없는" 정상 설문 전부를 위반으로 만든다. 그래서 불변식은 서비스(같은 팀 재검증, FOR UPDATE)와
-- 조회(team_id 동시 일치 조인)가 지키고, 팀을 옮기는 티켓이 survey_group_id 를 함께 NULL 로
-- 내리는 것이 계약이다.
--
-- RLS: 0035 하우스 룰 — 신규 public 테이블은 같은 마이그레이션에서 ENABLE (정책 0개 =
-- anon/authenticated deny-all, 앱은 BYPASSRLS 인 postgres 롤로만 접근).
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생(pnpm db:setup-test)과 재적용 양쪽 안전.

BEGIN;

CREATE TABLE IF NOT EXISTS survey_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  team_id uuid NOT NULL REFERENCES teams (id) ON DELETE RESTRICT,
  name text NOT NULL,
  "order" integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- 그룹 이름은 팀 안에서 유일하다. 팀 밖으로는 아무 의미가 없으므로 전역 UNIQUE 는 두지 않는다
-- (여러 팀이 "2025" 라는 그룹을 각자 갖는 것이 정상이다).
CREATE UNIQUE INDEX IF NOT EXISTS survey_groups_team_name_uq
  ON survey_groups (team_id, name);

-- 그룹 목록은 언제나 한 팀 안에서 정렬 순으로 읽는다.
CREATE INDEX IF NOT EXISTS survey_groups_team_order_idx
  ON survey_groups (team_id, "order");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'surveys_survey_group_id_survey_groups_id_fk'
  ) THEN
    ALTER TABLE surveys ADD CONSTRAINT surveys_survey_group_id_survey_groups_id_fk
      FOREIGN KEY (survey_group_id) REFERENCES survey_groups (id) ON DELETE SET NULL;
  END IF;
END $$;

-- 그룹 화면(?group=<id>)과 그룹별 설문 수가 이 인덱스를 탄다.
CREATE INDEX IF NOT EXISTS surveys_survey_group_id_idx ON surveys (survey_group_id);

COMMENT ON TABLE survey_groups IS
  '팀 공용 설문 그룹 — 정리용 묶음이며 접근 권한에 영향을 주지 않는다 (역할 모델 v2 티켓 12)';
COMMENT ON COLUMN survey_groups.team_id IS
  '소유 팀. 그룹은 팀 소유물이라 설문이 팀을 옮기면 survey_group_id 는 NULL 로 내려야 한다';
COMMENT ON COLUMN surveys.survey_group_id IS
  '소속 그룹 (NULL = 미분류). 그룹 삭제는 이 값을 NULL 로 돌릴 뿐 설문을 지우지 않는다';

ALTER TABLE survey_groups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE survey_groups FROM anon, authenticated;

COMMIT;
