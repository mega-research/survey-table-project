-- Migration: 0018_mail_templates
-- Purpose: 메일 템플릿 테이블 생성
-- Note: 설문별 메일 템플릿 저장소. 발송 기능은 별도 테이블/로직.

BEGIN;

CREATE TABLE "mail_templates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "survey_id" uuid NOT NULL REFERENCES "surveys"("id") ON DELETE CASCADE,

  "name" text NOT NULL,
  "subject" text NOT NULL DEFAULT '',
  "body_html" text NOT NULL DEFAULT '',

  "from_local" text NOT NULL DEFAULT '',
  "from_name" text NOT NULL DEFAULT '',
  "reply_to" text,

  "attachments" jsonb NOT NULL DEFAULT '[]'::jsonb,
  "variables_used" jsonb NOT NULL DEFAULT '[]'::jsonb,

  "deleted_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX "mail_templates_survey_id_idx"
  ON "mail_templates" ("survey_id")
  WHERE "deleted_at" IS NULL;

COMMIT;

-- ROLLBACK SQL (수동 적용용 — 본 마이그레이션 실패 시):
-- BEGIN;
-- DROP INDEX IF EXISTS mail_templates_survey_id_idx;
-- DROP TABLE IF EXISTS mail_templates;
-- COMMIT;
