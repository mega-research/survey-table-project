-- 앞 문항 설명 밑에 붙이기 (2026-11-05) — 접어 둔 문항(collapse_button_label)을 페이지에서 바로 앞에 보이는
-- 문항의 설명 밑에 붙인다(유가공업 「[붙임] 제품 품목 코드표」를 문1 설명 밑으로). 문항 id 로 잇지 않아 복제·보관함에서
-- 연결이 깨지지 않는다. 기본 false 라 기존 문항은 그대로다. DEFAULT 가 있어 구버전 앱 INSERT 도 깨지지 않으므로
-- 단일 단계 배포. 앱 배포 전에 적용한다 — 새 앱이 이 컬럼을 읽고 쓴다.
ALTER TABLE questions ADD COLUMN IF NOT EXISTS collapse_attach_previous boolean NOT NULL DEFAULT false;
