-- 모바일 표 표시 방식에 '축 단위 카드'(axis-cards) 를 추가한다.
-- 보기 그룹이 있는 보기-소스 표를 보기 그룹(축)마다 카드 하나로 세우고, 카드 안에 그 축에
-- 셀이 있는 행을 타일로 나열하는 방식. 축마다 독립된 다중·단일 선택인데 행 목록만 공유하는
-- 표(현재 활용 / 활용 계획)에 맞는다 — 행 카드로 그리면 행마다 모든 축에 답해야 하는 것처럼 읽힌다.
SET LOCAL lock_timeout = '3s';

ALTER TABLE "questions"
  DROP CONSTRAINT IF EXISTS "questions_mobile_table_display_mode_check";

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_mobile_table_display_mode_check"
  CHECK (
    "mobile_table_display_mode"
    IN ('auto', 'drilldown-original-row', 'row-wise-original', 'row-cards', 'row-group-cards', 'axis-cards', 'original')
  );
