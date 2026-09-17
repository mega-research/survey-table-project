-- 단답형·장문형 입력칸 높이 — 줄 수와 입력한 만큼 높이 늘리기.
--
-- 표 input 셀의 inputRows·inputAutoGrow(JSONB 셀 안)와 같은 뜻을 문항 레벨로 둔다.
-- input_rows: NULL = 유형 기본(단답형 한 줄, 장문형 4줄), 1~20 = 그 줄 수.
--             단답형에서 2 이상이면 여러 줄 칸이 된다. 숫자·입력 형식 칸은 한 줄 고정이다.
-- input_auto_grow: NULL·false = 고정 높이(기존 전부), true = 입력한 만큼 늘어나고 줄 수가 최소 높이.
-- nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS input_rows smallint;
ALTER TABLE questions ADD COLUMN IF NOT EXISTS input_auto_grow boolean;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_input_rows_range;
ALTER TABLE questions ADD CONSTRAINT questions_input_rows_range
  CHECK (input_rows IS NULL OR (input_rows >= 1 AND input_rows <= 20));

COMMENT ON COLUMN questions.input_rows IS
  '단답형·장문형 입력칸 줄 수 1~20. NULL = 유형 기본(단답형 1줄, 장문형 4줄).';
COMMENT ON COLUMN questions.input_auto_grow IS
  '단답형·장문형 입력한 만큼 높이 늘리기. NULL·false = 고정 높이.';
