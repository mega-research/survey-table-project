-- Migration: 0063_add_survey_force_wide_layout
-- Purpose: 설문 설정 "화면 너비" 토글
-- - surveys.force_wide_layout boolean (default false) — true 면 응답 페이지 컨테이너를
--   표 유무·총폭과 무관하게 항상 넓게(max-w-7xl). false 면 표 총폭 기준 자동 판정(기존 규칙).

ALTER TABLE surveys
ADD COLUMN IF NOT EXISTS force_wide_layout boolean DEFAULT false NOT NULL;
