-- 0139: 팀 종류 — 실사팀 표시 (2026-10-21)
--
-- 사이드바가 실사팀만 「참여 중」을 주인공으로 그리려면(설문 목록·그룹 트리 대신 소유 팀별
-- 참여 설문) 그 팀을 가려낼 표시가 필요하다. **권한 판정은 이 값을 보지 않는다** — capability
-- 코어·작업 범위·관문 어느 것도 읽지 않고, 화면 표시 하나를 위한 값이다. 그래서 기존 행은
-- 전부 standard 로 시작하고 지정은 슈퍼어드민이 팀 관리에서 한다(workspace.teams.setKind).
--
-- 감사 어휘에 kind_change 를 더한다 — 팀 이름 변경(rename)처럼 조직 표시를 바꾸는 일이다.
-- 0115 의 action CHECK 는 인라인이라 이름이 자동(team_lifecycle_events_action_check)이다.
--
-- staging 전용 번호다(teams 는 역할 v2 와 함께 승격된다). 빈 DB 재생 가능: 컬럼은 DEFAULT 로
-- 채워지고 제약 교체는 IF EXISTS 로 이름에 기대지 않는다.

BEGIN;

ALTER TABLE public.teams
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'standard';

ALTER TABLE public.teams DROP CONSTRAINT IF EXISTS teams_kind_check;
ALTER TABLE public.teams
  ADD CONSTRAINT teams_kind_check CHECK (kind IN ('standard', 'fieldwork'));

ALTER TABLE public.team_lifecycle_events DROP CONSTRAINT IF EXISTS team_lifecycle_events_action_check;
ALTER TABLE public.team_lifecycle_events
  ADD CONSTRAINT team_lifecycle_events_action_check CHECK (
    action IN ('create', 'rename', 'dissolve', 'member_add', 'member_role', 'member_remove', 'kind_change')
  );

COMMIT;
