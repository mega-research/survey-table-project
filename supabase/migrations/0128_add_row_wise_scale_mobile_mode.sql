-- 모바일 표 표시 방식에 '행별 척도'(row-wise-scale) 를 추가한다.
-- 「행별 원본 문항」과 같은 시트 구조(행 제목·섹션 머리)에서 원본 표 조각 자리만 척도 막대로
-- 그린다 — 11점 척도처럼 칸이 많은 행이 모바일에서 가로 스크롤로 넘어가지 않게 한다.
-- 막대로 그릴 수 없는 행은 그 행만 원본 표 조각으로 그린다(판정은 앱, DB 는 값만 받는다).
SET LOCAL lock_timeout = '3s';

ALTER TABLE "questions"
  DROP CONSTRAINT IF EXISTS "questions_mobile_table_display_mode_check";

ALTER TABLE "questions"
  ADD CONSTRAINT "questions_mobile_table_display_mode_check"
  CHECK (
    "mobile_table_display_mode"
    IN ('auto', 'drilldown-original-row', 'row-wise-original', 'row-wise-scale', 'row-cards', 'row-group-cards', 'axis-cards', 'original')
  );
