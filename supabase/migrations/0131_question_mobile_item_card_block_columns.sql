-- 「항목 단위 카드」 블록 시작 열 — 좌우로 붙은 표(학력별 | 경력별)를 모바일에서 블록마다 차례로 세운다.
--
-- 저작자가 블록이 시작하는 열 번호(1부터, 작성 열 순서)를 적는다. 자동 추정은 없다 — "입력 칸 뒤에
-- 라벨이 다시 나온다"는 신호는 양식형 표의 평범한 항목 경계와 구별되지 않는다.
--
-- 정수 배열(예: [1, 5]). NULL = 블록 없음(기존 전부, 행 순서 그대로).
-- nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS mobile_item_card_block_columns jsonb;

COMMENT ON COLUMN questions.mobile_item_card_block_columns IS
  '항목 단위 카드 블록 시작 열 번호 배열(1부터). NULL = 블록 없음.';
