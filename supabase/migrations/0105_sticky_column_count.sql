-- 표를 그리는 문항의 좌측 고정 열 개수.
-- NULL=자동 판정(현행 유지, 좌측 연속 정적 셀 열까지 고정), 0=고정 안 함, 1~3=명시 지정.
-- 기본을 0 이 아니라 NULL 로 두는 이유는 회귀 방지다 — 0 이 기본이면 지금 고정돼 있는
-- 표가 전부 풀린다. nullable 추가라 단일 단계 배포 가능 (구버전 앱 INSERT 영향 없음).
ALTER TABLE questions ADD COLUMN IF NOT EXISTS sticky_column_count smallint;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_sticky_column_count_range;
ALTER TABLE questions ADD CONSTRAINT questions_sticky_column_count_range
  CHECK (sticky_column_count IS NULL OR (sticky_column_count >= 0 AND sticky_column_count <= 3));
