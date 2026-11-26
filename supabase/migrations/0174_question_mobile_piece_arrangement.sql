-- 조각 좌우 반전 · 조각 한 화면 칸 수 (2026-11-26, PRD .scratch/mobile-piece-reverse) — 좁은 화면(휴대폰)의
-- 원본 표 조각에만 적용하는 문항 단위 표현 설정 둘. 표 구조·응답값·PC 화면은 바꾸지 않는다.
--   mobile_drilldown_reverse_columns  true = 조각의 열을 작성 순서의 반대로 그린다. false = 작성 순서(기존 문항 전부).
--   mobile_drilldown_columns_per_view 3~6 = 조각이 놓인 자리 폭을 이 수로 나눠 칸 폭을 정한다. NULL = 원본 열 폭(기존 문항 전부).
--
-- 칸 수 범위는 세 곳이 함께 간다 — 어휘 상수(src/types/mobile-table-display.ts) · 스키마 check()(src/db/schema/surveys.ts) ·
-- 이 CHECK. tests/repo/mobile-piece-columns-per-view-column.test.ts 가 셋을 대조한다. 범위를 바꿀 때는 이 파일을
-- 고치지 말고 새 마이그레이션에서 제약을 갈아끼운다.
--
-- 반전은 DB 기본값(false)이 있고 칸 수는 nullable 이라 구버전 앱 INSERT 가 깨지지 않는다 — 단일 단계 배포.
-- 앱 배포 전에 적용한다 — 새 앱이 두 컬럼을 읽고 쓴다.
SET LOCAL lock_timeout = '3s';

ALTER TABLE questions
  ADD COLUMN IF NOT EXISTS mobile_drilldown_reverse_columns boolean NOT NULL DEFAULT false;

ALTER TABLE questions ADD COLUMN IF NOT EXISTS mobile_drilldown_columns_per_view integer;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_mobile_drilldown_columns_per_view_check;

ALTER TABLE questions
  ADD CONSTRAINT questions_mobile_drilldown_columns_per_view_check
  CHECK (
    mobile_drilldown_columns_per_view IS NULL
    OR (mobile_drilldown_columns_per_view >= 3 AND mobile_drilldown_columns_per_view <= 6)
  );

COMMENT ON COLUMN questions.mobile_drilldown_reverse_columns IS
  '조각 좌우 반전. true = 좁은 화면의 원본 표 조각에서 열을 작성 순서의 반대로 그린다.';
COMMENT ON COLUMN questions.mobile_drilldown_columns_per_view IS
  '조각 한 화면 칸 수. NULL = 원본 열 폭. 3~6 = 좁은 화면의 원본 표 조각에서 자리 폭을 이 수로 나눈 칸 폭.';
