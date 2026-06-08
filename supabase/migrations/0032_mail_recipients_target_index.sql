-- 조사 대상 목록 "메일" 컬럼 — 조사 대상별 최신 메일 상태 subquery 가속.
-- contact_target_id 로 필터 후 created_at DESC 1건 조회 (latestMailStatusExpr).
-- 기존 UNIQUE(campaign_id, contact_target_id) 는 contact_target_id 선두 조회에 무용.
CREATE INDEX IF NOT EXISTS "idx_mail_recipients_target_created"
  ON "mail_recipients" ("contact_target_id", "created_at" DESC);
