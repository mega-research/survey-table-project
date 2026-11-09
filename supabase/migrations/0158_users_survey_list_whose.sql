-- 0158: 설문 목록에서 마지막으로 고른 보는 자리 — 「팀 전체」 | 「내 설문」 (2026-11-09)
--
-- 계정마다 하나. null 이면 아직 고른 적이 없어 역할 기본값(팀장·슈퍼어드민은 팀 전체, 팀원은 내 설문)을
-- 쓴다 — 판정은 `defaultSurveyListWhose`(shared/contracts/survey-builder-io). 브라우저가 아니라 계정에 두는
-- 것은 PC 를 바꿔도 같은 화면으로 열리게 하기 위해서다.
--
-- nullable 칸 추가라 구버전 앱과 양립한다(2단계 배포 불필요). 앱 배포 전 적용.

BEGIN;

ALTER TABLE users ADD COLUMN IF NOT EXISTS survey_list_whose text;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_survey_list_whose_check') THEN
    ALTER TABLE users
      ADD CONSTRAINT users_survey_list_whose_check
      CHECK (survey_list_whose IS NULL OR survey_list_whose IN ('team', 'mine'));
  END IF;
END $$;

COMMIT;
