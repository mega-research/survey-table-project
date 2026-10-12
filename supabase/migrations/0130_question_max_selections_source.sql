-- 체크박스 최대 선택 개수를 다른 문항의 숫자 응답에서 가져온다.
--
-- "B2 에 적은 담당 팀 수만큼만 B3 에서 고를 수 있다" 요구를 담는다. 고정 숫자 max_selections 는
-- 그대로 두고, 이 컬럼이 있으면 참조 문항의 응답값이 상한이 된다(못 읽으면 고정값 폴백).
-- 차단은 클라이언트에서만 한다 — 선택 가드와 「다음」 검증. 저장 경로는 검증하지 않는다.
--
-- {questionId: string, unlimitedFrom?: number}. NULL = 고정값만(기존 전부).
-- nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS max_selections_source jsonb;

COMMENT ON COLUMN questions.max_selections_source IS
  '최대 선택 개수 출처 {questionId, unlimitedFrom}. NULL = 고정 max_selections 만.';
