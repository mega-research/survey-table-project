-- 표를 그리는 문항의 「화면 폭에 맞춰 표 줄이기」 (2026-10-29).
-- 켜면 응답 화면(모바일 모드가 아닐 때)에서 열 폭을 비율로 바꿔 좁은 화면(아이패드 세로 등)에 맞춰 줄이고,
-- 넓은 화면에서는 지정한 총폭을 넘지 않는다. 끄면(기본) 기존처럼 지정 px 고정 + 가로 스크롤.
-- 기본 false 라 기존 표는 그대로다. DEFAULT 가 있어 구버전 앱 INSERT 도 깨지지 않으므로 단일 단계 배포.
-- 앱 배포 전에 적용한다 — 새 앱이 이 컬럼을 쓴다.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS fit_table_to_width boolean NOT NULL DEFAULT false;
