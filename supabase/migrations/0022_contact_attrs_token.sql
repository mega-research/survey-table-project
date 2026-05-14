-- Migration: 0022_contact_attrs_token
-- Purpose: 컨택 attrs 토큰 — 설문 빌더 확장
-- - surveys.require_invite_token boolean (default false) — 익명 접근 차단 토글
-- - questions.default_value_template text (nullable) — 단답형 prefill 템플릿
-- TableCell.defaultValueTemplate 은 JSONB 옵셔널 필드라 마이그레이션 불필요.

BEGIN;

ALTER TABLE "surveys"
  ADD COLUMN "require_invite_token" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "surveys"."require_invite_token" IS
  '컨택 attrs 토큰 사용 시 ?invite= 강제 여부. true면 invite 없는 접근 차단.';

ALTER TABLE "questions"
  ADD COLUMN "default_value_template" text;

COMMENT ON COLUMN "questions"."default_value_template" IS
  '단답형(text) 질문 prefill 템플릿. {{attrs_key}} 토큰 포함 가능. 응답 시점에 attrs로 치환되어 readonly 입력으로 표시.';

COMMIT;

-- ROLLBACK SQL (수동):
-- BEGIN;
-- ALTER TABLE questions DROP COLUMN IF EXISTS default_value_template;
-- ALTER TABLE surveys DROP COLUMN IF EXISTS require_invite_token;
-- COMMIT;
