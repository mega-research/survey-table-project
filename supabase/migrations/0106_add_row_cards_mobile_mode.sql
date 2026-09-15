-- 모바일 표 표시 방식에 '행 단위 카드'(row-cards) 를 추가한다.
-- 보기-소스 표에서 행마다 카드 하나를 만들고 그 안에 열별 선택을 나란히 두는 방식.
SET LOCAL lock_timeout = '3s';

ALTER TABLE "questions"
  DROP CONSTRAINT IF EXISTS "questions_mobile_table_display_mode_check";

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_mobile_table_display_mode_check"
  CHECK (
    "mobile_table_display_mode"
    IN ('auto', 'drilldown-original-row', 'row-wise-original', 'row-cards', 'original')
  );
