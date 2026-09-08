-- 표 문항 행 반복 (응답자가 + 로 행 묶음을 늘린다)
--
-- 동적 행 그룹(dynamic_row_config)과 의미가 다르다. 저쪽은 빌더가 만들어 둔 행 풀에서
-- 응답자가 고르는 것이고, 이쪽은 같은 모양의 칸을 원하는 벌 수만큼 반복하는 것이다.
-- 한 자료구조에 두 의미를 얹으면 조건 평가와 소계 행 연동이 얽히므로 컬럼을 분리한다.
--
-- 펼쳐진 행 자체는 table_rows_data 에 실제로 눌러앉는다 — 응답값 키가 발행 스냅샷 안의
-- cell.id 로 유지되어 저장·검증·내보내기·이월 임포트가 전부 무변경이다. 이 컬럼은
-- 템플릿 행 지정과 상한(최대 20벌)만 쥔다.
--
-- NULL = 행 반복을 쓰지 않는 표(기존 전부).
-- nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 2단계 배포 대상이 아니다.
ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS row_repeat_config jsonb;

COMMENT ON COLUMN questions.row_repeat_config IS
  '표 문항 행 반복 설정 {enabled, templateRowIds, maxRepeats, addLabel}. 펼친 행은 table_rows_data 에 있다.';
