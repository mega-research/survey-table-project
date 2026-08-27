-- 0091: 설문 소유권 이동 감사. (2026-08-27, 역할 모델 v2 티켓 14)
--
-- 팀 수명주기는 team_lifecycle_events 가, 계정 상태는 user_status_events 가 남긴다. 설문의
-- 소유 팀·소유자가 움직이는 사건만 어디에도 안 남아 있었다 — 재배치 센터(티켓 14)가 첫 쓰기
-- 주체고 소유권 승계(티켓 19)가 같은 테이블을 이어 쓴다.
--
-- 이 테이블이 없으면 못 하는 일이 둘이다.
--   1. 해산으로 배치 대기가 된 설문의 **출신 팀**을 되짚는 것. 해산은 surveys.team_id 를 NULL
--      로 내리므로 설문 행만 봐서는 어느 팀에서 왔는지 알 수 없고, 팀 쪽 감사(dissolve)는
--      규모(surveyCount)만 적을 뿐 어느 설문인지 적지 않는다. .pen FLOW 8-4 의
--      「현재 소유 팀 · 해산됨」 줄이 이 계보에서 나온다.
--   2. "누가 이 설문을 저 팀으로 옮겼는가" 를 사후에 답하는 것.
--
-- action 어휘:
--   unassign  팀을 잃었다 (해산). to_team_id·to_owner_id 는 NULL.
--   assign    배치 대기 → 팀 배치 (재배치 센터). from_team_id 는 NULL.
--   transfer  팀·소유자 이동 (티켓 19 승계·수동 이전이 쓴다).
--
-- survey_id 는 **CASCADE** 다. 현행 설문 삭제는 하드 삭제라(deleteSurvey → tx.delete)
-- RESTRICT 로 걸면 감사 행 하나 때문에 설문을 영영 못 지운다. 같은 이유로 형제 감사인
-- response_edit_logs 도 CASCADE 다. 소프트 삭제 전환(티켓 17) 뒤에도 이 선택은 유효하다 —
-- 감사는 설문이 존재하는 동안의 이력이고, 설문이 사라지면 주어가 없다.
--
-- 나머지 FK 는 전부 RESTRICT — 사람과 팀은 하드 삭제되지 않는다(퇴사는 status, 해산은
-- archived). 실수로 지우면 계보가 끊긴다.

BEGIN;

CREATE TABLE IF NOT EXISTS survey_ownership_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  action text NOT NULL CHECK (action IN ('unassign', 'assign', 'transfer')),
  from_owner_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  to_owner_id uuid REFERENCES users (id) ON DELETE RESTRICT,
  from_team_id uuid REFERENCES teams (id) ON DELETE RESTRICT,
  to_team_id uuid REFERENCES teams (id) ON DELETE RESTRICT,
  changed_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  -- 사건 시점의 부수 정보 (팀 이름·공개 범위 전후 등). 팀 이름을 함께 적는 이유는
  -- team_lifecycle_events 와 같다 — 나중에 조인하면 지금 이름만 보인다.
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 설문 하나의 계보를 시간순으로 읽는 것이 유일한 조회 패턴이다.
CREATE INDEX IF NOT EXISTS survey_ownership_events_survey_idx
  ON survey_ownership_events (survey_id, created_at DESC);

COMMENT ON TABLE survey_ownership_events IS
  '설문 소유 팀·소유자 이동 감사 (append-only). 해산으로 지워진 출신 팀을 되짚는 유일한 경로';

ALTER TABLE survey_ownership_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE survey_ownership_events FROM anon, authenticated;

COMMIT;
