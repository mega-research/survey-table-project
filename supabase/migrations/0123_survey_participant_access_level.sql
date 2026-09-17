-- 0123: 참여자 권한 등급. (2026-09-17, 역할 모델 v2 병합 후 Codex 적대적 리뷰)
--
-- 팀 공개 설문의 일반 팀원도 참여자를 초대할 수 있는데(survey.invite), 참여자 열은 팀원 열보다
-- 넓다 — 응답 상세·컨택 원본·메일·export·삭제까지 받는다. 그래서 팀원이 **자기 자신이나 동료를
-- 초대하는 것만으로** 팀원에게 막아 둔 개인 데이터 접근을 얻었다.
--
-- 초대를 좁히지 않고 초대의 결과를 좁힌다(사용자 결정). 초대한 사람이 참여자 열 전부를 갖고
-- 있지 않으면 새 참여자는 'limited' 로 서고, 판정 코어가 limited 에게는 참여자 열과 팀원 열의
-- 교집합(열람·편집·초대·현황·분석)만 준다. 초대받은 사람이 초대한 사람보다 넓어지지 않는다.
--
-- 기존 행은 전부 'full' 이다. 지금까지의 초대가 어떤 권한으로 이뤄졌는지 알 수 없고(added_by 의
-- 그 시점 역할은 기록되지 않는다), 이미 일하고 있는 참여자의 권한을 배포로 줄이면 안 된다.
-- DEFAULT 가 있어 이 컬럼을 모르는 구버전 앱의 INSERT 도 그대로 통과한다(주의사항 8 의 2단계
-- 배포가 필요 없는 모양).
--
-- member 가 아닌 kind(guest·fieldwork)에서는 판정이 이 값을 읽지 않는다 — 그쪽 열은 kind 가
-- 이미 고정한다. CHECK 로 member 전용을 강제하지 않는 것은 DEFAULT 'full' 이 모든 행에
-- 들어가기 때문이다.
--
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생과 재적용 양쪽 안전.

BEGIN;

ALTER TABLE survey_participants
  ADD COLUMN IF NOT EXISTS access_level text NOT NULL DEFAULT 'full';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'survey_participants_access_level_check'
  ) THEN
    ALTER TABLE survey_participants ADD CONSTRAINT survey_participants_access_level_check
      CHECK (access_level IN ('full', 'limited'));
  END IF;
END $$;

COMMENT ON COLUMN survey_participants.access_level IS
  'kind=member 전용 권한 등급. full=참여자 열 전부, limited=참여자 열과 팀원 열의 교집합 — 초대자가 참여자 열 전부를 갖지 않았을 때 (0123)';

COMMIT;
