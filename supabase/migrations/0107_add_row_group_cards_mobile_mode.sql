-- 모바일 표 표시 방식에 '행 단위 그룹 카드'(row-group-cards) 를 추가한다.
-- 보기-소스 표에서 행마다 카드 하나를 만들고, 그 안을 보기 그룹(축)별 섹션으로 나눠
-- 각 섹션에 그 그룹의 보기를 두는 방식. 행마다 여러 축(인지 여부·필요성·참여 의향)을
-- 하나씩 고르는 표에 맞는다.
SET LOCAL lock_timeout = '3s';

ALTER TABLE "questions"
  DROP CONSTRAINT IF EXISTS "questions_mobile_table_display_mode_check";

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_mobile_table_display_mode_check"
  CHECK (
    "mobile_table_display_mode"
    IN ('auto', 'drilldown-original-row', 'row-wise-original', 'row-cards', 'row-group-cards', 'original')
  );
