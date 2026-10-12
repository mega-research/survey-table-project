-- 모바일 표 표시 방식에 '항목 단위 카드'(item-cards) 를 추가한다.
-- 한 행에 「라벨 + 입력」 쌍이 여럿 놓인 양식형 표를 라벨(항목)마다 카드 하나로 세운다 —
-- 행 단위 카드는 그런 표에서 서로 다른 항목을 한 카드에 섞는다. 묶음 판정은 앱, DB 는 값만 받는다.
SET LOCAL lock_timeout = '3s';

ALTER TABLE "questions"
  DROP CONSTRAINT IF EXISTS "questions_mobile_table_display_mode_check";

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_mobile_table_display_mode_check"
  CHECK (
    "mobile_table_display_mode"
    IN ('auto', 'drilldown-original-row', 'row-wise-original', 'row-wise-scale', 'row-cards', 'row-group-cards', 'axis-cards', 'item-cards', 'original')
  );
