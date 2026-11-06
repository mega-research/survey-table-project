-- 문항 접어 두기 (2026-11-05) — 글자가 있으면 응답 화면에서 문항 자리에 그 글자의 버튼만 보이고,
-- 누르면 문항 전체가 펼쳐지고 다시 누르면 접힌다(유가공업 실태조사 「[붙임] 제품 품목 코드표」).
-- NULL = 꺼짐(기존 전부). nullable 컬럼 추가라 구버전 앱 INSERT 가 깨지지 않는다 — 단일 단계 배포.
-- 앱 배포 전에 적용한다 — 새 앱이 이 컬럼을 읽고 쓴다.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS collapse_button_label text;

COMMENT ON COLUMN questions.collapse_button_label IS
  '문항 접어 두기 버튼 글자. NULL·공백 = 꺼짐. 글자가 있으면 응답 화면에서 버튼을 눌러야 문항이 펼쳐진다.';
