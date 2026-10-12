-- 표 문항 「행 차례로 열기」 (저작된 행 묶음을 처음 몇 행만 보이고 응답자가 + 로 한 행씩 연다)
--
-- 행 반복(row_repeat_config, 0104)과 의미가 다르다. 저쪽은 템플릿 1벌을 구조에 복제하고,
-- 이쪽은 저작자가 직접 만든 평범한 행을 가릴 뿐이다. 묶음의 행은 table_rows_data 에 처음부터
-- 있고 이 컬럼은 묶음의 행 id 목록·처음 보이는 행 수·버튼 문구만 쥔다 — 구조를 펼치거나
-- 접지 않으므로 응답값 키·내보내기 열은 설정과 무관하게 그대로다 (ADR 0028).
--
-- NULL = 쓰지 않는 표(기존 전부).
-- nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS staged_rows_config jsonb;

COMMENT ON COLUMN questions.staged_rows_config IS
  '표 문항 행 차례로 열기 설정 {enabled, rowIds, initialVisibleCount, addLabel}. 묶음의 행은 table_rows_data 의 평범한 행이다.';
