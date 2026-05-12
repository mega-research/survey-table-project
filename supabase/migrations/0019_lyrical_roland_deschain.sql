-- Migration: 0019_contact_pii
-- Purpose: PII 사이드 테이블 도입 (contact_pii) + contact_targets 평문 컬럼 제거 + RLS 활성화
-- Note: 멱등 SQL — 이미 적용된 DB 에 다시 실행해도 안전.
--       surveys.user_id 가 owner 컬럼 (created_by 아님 — 0019 작성 시점에 정정).
--
-- 위험 회피 (이 SQL 작성 시점에 학습된 교훈):
--   ✗ 절대 금지: TRUNCATE TABLE contact_targets CASCADE
--     → PG 의 TRUNCATE CASCADE 는 ON DELETE SET NULL 을 무시하고 참조 행 (survey_responses,
--       response_answers) 까지 모두 강제 TRUNCATE. 응답 데이터 손실 발생.
--   ✓ 사용: UPDATE NULL + DELETE FROM
--     → ON DELETE SET NULL FK 액션을 정상 적용하여 survey_responses 행은 보존.

BEGIN;

-- 1) 기존 컨택 데이터 정리 (응답은 보존 — contact_target_id 만 NULL 로 끊음)
UPDATE "survey_responses" SET "contact_target_id" = NULL
  WHERE "contact_target_id" IS NOT NULL;
DELETE FROM "contact_attempts";
DELETE FROM "contact_targets";
DELETE FROM "contact_uploads";

-- 2) PII 사이드 테이블 (멱등)
CREATE TABLE IF NOT EXISTS "contact_pii" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "contact_target_id" uuid NOT NULL REFERENCES "contact_targets"("id") ON DELETE CASCADE,
  "field_type" text NOT NULL,
  "column_key" text NOT NULL,
  "cipher" text NOT NULL,
  "blind_index" text NOT NULL,
  "mask_hint" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "contact_pii_target_column_unique" UNIQUE ("contact_target_id", "column_key")
);
CREATE INDEX IF NOT EXISTS "idx_contact_pii_target" ON "contact_pii" ("contact_target_id");
CREATE INDEX IF NOT EXISTS "idx_contact_pii_field_blind" ON "contact_pii" ("field_type", "blind_index");

-- 3) contact_targets 평문 PII 컬럼 + 관련 인덱스 제거 (멱등)
DROP INDEX IF EXISTS "idx_contact_targets_email";
ALTER TABLE "contact_targets" DROP COLUMN IF EXISTS "email";
ALTER TABLE "contact_targets" DROP COLUMN IF EXISTS "biz_number";

-- 4) RLS 활성화 + owner-only 정책 (멱등 — 정책 이름으로 DROP IF EXISTS 후 재생성)
ALTER TABLE "contact_targets" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "contact_pii" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "contact_targets_owner_all" ON "contact_targets";
CREATE POLICY "contact_targets_owner_all" ON "contact_targets"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "surveys" s
      WHERE s.id = contact_targets.survey_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "surveys" s
      WHERE s.id = contact_targets.survey_id
        AND s.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "contact_pii_owner_all" ON "contact_pii";
CREATE POLICY "contact_pii_owner_all" ON "contact_pii"
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM "contact_targets" ct
      JOIN "surveys" s ON s.id = ct.survey_id
      WHERE ct.id = contact_pii.contact_target_id
        AND s.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM "contact_targets" ct
      JOIN "surveys" s ON s.id = ct.survey_id
      WHERE ct.id = contact_pii.contact_target_id
        AND s.user_id = auth.uid()
    )
  );

COMMIT;

-- Rollback (참고용 — 비가역 컬럼 DROP 으로 인해 원상 복귀는 불가능. 백업 복원 필요):
-- DROP TABLE IF EXISTS "contact_pii";
-- ALTER TABLE "contact_targets" ADD COLUMN "email" text;
-- ALTER TABLE "contact_targets" ADD COLUMN "biz_number" text;
-- CREATE INDEX "idx_contact_targets_email" ON "contact_targets" ("survey_id", "email") WHERE "email" IS NOT NULL;
-- ALTER TABLE "contact_targets" DISABLE ROW LEVEL SECURITY;
-- DROP POLICY IF EXISTS "contact_targets_owner_all" ON "contact_targets";
