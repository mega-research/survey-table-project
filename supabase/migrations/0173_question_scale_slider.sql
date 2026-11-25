-- 문항의 슬라이더 방향 (2026-11-24, CONTEXT.md 「척도 슬라이더」) — 보통 라디오 문항과 묶음 없는 보기 소스 표를
-- 타일 줄과 트랙으로 그리게 하는 문항 단위 설정. 값이 있으면 켜진 것이고 그 값이 긍정 방향이다
-- ('positive-right' 오른쪽이 긍정 · 'positive-left' 왼쪽이 긍정). NULL = 꺼짐(기존 문항 전부).
-- 보기 묶음 쪽 설정은 choice_groups JSONB 안에 있어 이 컬럼과 무관하다.
--
-- 값 목록은 세 곳이 함께 간다 — 어휘 배열(src/types/scale-slider.ts) · 스키마 check()(src/db/schema/surveys.ts) ·
-- 이 CHECK. tests/repo/scale-slider-question-column.test.ts 가 셋을 대조한다. 값을 늘릴 때는 이 파일을 고치지 말고
-- 새 마이그레이션에서 제약을 갈아끼운다.
--
-- 기본값 없는 nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 단일 단계 배포.
-- 앱 배포 전에 적용한다 — 새 앱이 이 컬럼을 읽고 쓴다.
SET LOCAL lock_timeout = '3s';

ALTER TABLE questions ADD COLUMN IF NOT EXISTS scale_slider text;

ALTER TABLE questions DROP CONSTRAINT IF EXISTS questions_scale_slider_check;

ALTER TABLE questions
  ADD CONSTRAINT questions_scale_slider_check
  CHECK (scale_slider IS NULL OR scale_slider IN ('positive-right', 'positive-left'));

COMMENT ON COLUMN questions.scale_slider IS
  '문항의 슬라이더 방향. NULL = 꺼짐. positive-right | positive-left = 척도 슬라이더로 그리고 그 쪽이 긍정이다.';
