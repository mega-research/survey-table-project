-- 0112: 대리 응답 귀속 — 이 응답을 어느 실사원이 대신 입력했는가. (2026-08-31, 역할 모델 v2 티켓 27)
--
-- 실사가 조사 대상 화면의 「응답 대행」으로 컨택의 초대 링크를 열면 **응답자와 똑같은
-- 응답 페이지**가 뜬다(ADR-0019). 그래서 저장된 응답만 놓고 보면 응답자가 직접 넣은 것과
-- 실사가 대신 넣은 것이 구별되지 않는다 — 검수와 정산이 그 구별을 요구한다.
--
-- **NULL 이 기본이고 그것이 응답자 직접 응답이다.** 컬럼을 NOT NULL 로 만들 수 없는 것이
-- 아니라, 만들면 안 된다: 응답 경로의 절대다수가 실사와 무관하고 NULL 이 그 사실을 말한다.
--
-- RESTRICT 인 이유는 형제 감사 컬럼들과 같다(`contact_attempts.created_by`,
-- `survey_participants.added_by`) — 사람은 하드 삭제되지 않고(퇴사는 status 전이다),
-- 실수로 지우면 「누가 대행했는가」가 끊긴다.
--
-- 인덱스는 **부분 인덱스**다. 이 컬럼을 조건으로 거는 질문은 언제나 「대행된 응답」 쪽이고,
-- 전체 행의 대부분은 NULL 이라 색인에 담을 이유가 없다.
--
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생과 재적용 양쪽 안전.

BEGIN;

ALTER TABLE survey_responses
  ADD COLUMN IF NOT EXISTS fieldwork_user_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'survey_responses_fieldwork_user_id_fkey'
      AND conrelid = 'survey_responses'::regclass
  ) THEN
    ALTER TABLE survey_responses ADD CONSTRAINT survey_responses_fieldwork_user_id_fkey
      FOREIGN KEY (fieldwork_user_id) REFERENCES public.users (id) ON DELETE RESTRICT;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS survey_responses_fieldwork_user_idx
  ON survey_responses (fieldwork_user_id, survey_id)
  WHERE fieldwork_user_id IS NOT NULL;

COMMENT ON COLUMN survey_responses.fieldwork_user_id IS
  '대리 응답을 입력한 실사 계정 (public.users). NULL 이면 응답자 직접 응답 — 티켓 27';

COMMIT;
