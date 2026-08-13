-- R2 파일 안전 삭제: 유예 삭제 큐 + 발송 장부 (PRD .scratch/r2-안전-삭제, ADR 0001)
-- 멱등 (IF NOT EXISTS) — apply-manual-migrations.mjs 재실행 안전.
BEGIN;

CREATE TABLE IF NOT EXISTS r2_deletion_candidates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL,
  source text NOT NULL,
  reason text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'cancelled', 'kept', 'deleted', 'failed')),
  registered_at timestamptz NOT NULL DEFAULT now(),
  execute_after timestamptz NOT NULL,
  resolved_at timestamptz,
  result_note text
);

-- 같은 키의 '대기' 후보 중복 등록 차단 (등록은 ON CONFLICT DO NOTHING 으로 흡수)
CREATE UNIQUE INDEX IF NOT EXISTS r2_deletion_candidates_pending_key_uq
  ON r2_deletion_candidates (key) WHERE status = 'pending';
-- 집행자 기한 배치 조회용
CREATE INDEX IF NOT EXISTS r2_deletion_candidates_due_idx
  ON r2_deletion_candidates (execute_after) WHERE status = 'pending';

CREATE TABLE IF NOT EXISTS r2_sent_keys (
  key text PRIMARY KEY,
  first_sent_at timestamptz NOT NULL DEFAULT now()
);

-- 신규 public 테이블은 같은 마이그레이션에서 RLS ENABLE (0035 관행)
ALTER TABLE r2_deletion_candidates ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE r2_deletion_candidates FROM anon, authenticated;
ALTER TABLE r2_sent_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE r2_sent_keys FROM anon, authenticated;

COMMIT;
