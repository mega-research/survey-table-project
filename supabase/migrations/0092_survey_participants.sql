-- 0092: 설문 단위 부여 저장소. (2026-08-28, 역할 모델 v2 티켓 18)
--
-- 참여자·게스트·실사를 **한 테이블**에 담는다(스펙 §9). 셋이 말하는 사실이 하나이기
-- 때문이다 — "이 사람은 이 설문에 초대돼 있다". 저장소를 나누면 「이 설문에 누가 초대돼
-- 있는가」를 묻는 데 세 번 조인해야 하고, 공유 설정 모달(.pen FLOW 4-2) 한 화면이 그 셋을
-- 한꺼번에 그린다. 0049(워크트리 참조 구현)의 survey_collaborators(editor/viewer)를 대체하며
-- v2 는 역할을 단일화했으므로 role 컬럼이 없다.
--
-- **팀 경계를 넘는 유일한 접근 경로다.** 지금까지 설문 접근은 전부 surveys.team_id 를 지나
-- 판정됐는데(ADR-0006·0008) 이 테이블만 그 축 밖에 있다 — 타 팀 사람을 그 설문 하나에만
-- 들인다. 그래서 여기 행이 하나 생기는 것과 팀 멤버십이 생기는 것은 전혀 다른 일이고,
-- team_members 에는 아무것도 쓰지 않는다.
--
-- kind 와 users.user_type 의 정합은 **서비스가 지킨다**. DB CHECK 로 못 거는 이유는 두
-- 테이블에 걸친 조건이라서다(CHECK 는 같은 행만 본다). guest 계정을 member 로 초대해도
-- capability 코어의 계정 유형 게이트가 전부 거부하지만, 그 전에 입구에서 막아야 「추가됐는데
-- 아무것도 안 되는」 유령 행이 안 생긴다.
--
-- FK 방향이 서로 다르다.
--  - survey_id CASCADE : 설문이 하드 삭제되면 부여도 의미가 없다. 티켓 17 이후 앱의 삭제는
--    soft delete 라 이 경로는 사실상 안 쓰이지만, RESTRICT 로 두면 언젠가 실제로 지우려 할 때
--    부여 행 하나가 그것을 영구히 막는다(survey_ownership_events 와 같은 판단).
--  - user_id·added_by RESTRICT : 사람은 하드 삭제되지 않는다(퇴사는 status 전이다).
--    실수로 지우면 "누가 누구를 초대했는가" 가 끊긴다.
--
-- UNIQUE(survey_id, user_id) — 한 사람이 한 설문에 두 자격으로 서지 않는다. kind 를 키에
-- 넣지 않는 것이 의도다: 같은 사람이 member 이자 guest 인 상태는 판정을 모호하게 만든다.
--
-- guest_tabs 는 kind='guest' 전용 JSONB 화이트리스트다(티켓 21 이 소비). 지금 컬럼을 세우는
-- 이유는 나중에 추가하면 이미 쌓인 행에 기본값을 소급해야 해서다.
--
-- RLS: 0035 하우스 룰 — 신규 public 테이블은 같은 마이그레이션에서 ENABLE (정책 0개 =
-- anon/authenticated deny-all, 앱은 BYPASSRLS 인 postgres 롤로만 접근).
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생(pnpm db:setup-test)과 재적용 양쪽 안전.

BEGIN;

CREATE TABLE IF NOT EXISTS survey_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  survey_id uuid NOT NULL REFERENCES surveys (id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  kind text NOT NULL,
  guest_tabs jsonb,
  added_by uuid NOT NULL REFERENCES users (id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now()
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_participants_kind_check'
  ) THEN
    ALTER TABLE survey_participants ADD CONSTRAINT survey_participants_kind_check
      CHECK (kind IN ('member', 'guest', 'fieldwork'));
  END IF;
END $$;

-- 한 사람이 한 설문에 두 자격으로 서지 않는다.
CREATE UNIQUE INDEX IF NOT EXISTS survey_participants_survey_user_uq
  ON survey_participants (survey_id, user_id);

-- 공유 모달이 설문 하나의 부여 전체를 읽는다(kind 별로 블록이 갈린다).
CREATE INDEX IF NOT EXISTS survey_participants_survey_kind_idx
  ON survey_participants (survey_id, kind);

-- 목록 조회가 "내가 초대받은 설문" 을 뒤집어 읽는다 — 이 인덱스가 그 방향을 받는다.
CREATE INDEX IF NOT EXISTS survey_participants_user_idx
  ON survey_participants (user_id);

COMMENT ON TABLE survey_participants IS
  '설문 단위 부여 — 참여자(member)·게스트·실사 통합. 팀 경계를 넘는 유일한 접근 경로 (역할 모델 v2 티켓 18)';
COMMENT ON COLUMN survey_participants.kind IS
  'member|guest|fieldwork. users.user_type 과의 정합은 서비스가 지킨다 (두 테이블에 걸친 조건이라 CHECK 불가)';
COMMENT ON COLUMN survey_participants.guest_tabs IS
  'kind=guest 전용 현황 탭 화이트리스트 (티켓 21 이 소비)';

ALTER TABLE survey_participants ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE survey_participants FROM anon, authenticated;

COMMIT;
