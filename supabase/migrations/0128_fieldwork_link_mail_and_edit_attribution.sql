-- 0128: 외주 실사 링크 귀속 — 이 단건 메일·이 응답 수정을 어느 링크가 했는가. (2026-09-30, ADR-0027)
--
-- ADR-0027 이 링크에 단건 메일(`mail.sendSingle`)과 응답 수정(`responses.view`)을 열었다.
-- 0127 과 같은 이유로 **옆 칸을 하나씩** 둔다 — 외주에게는 계정이 없어 기존 계정 칸
-- (`mail_campaigns.created_by`·`response_edit_logs.edited_by`)에 채울 값이 없다.
--
-- **NULL 이 기본이고 그것이 「링크가 아닌 경로」다.**
--
-- **배타 CHECK** — 계정 칸과 링크 칸 중 최대 하나만 채워진다(0127 과 같은 모양).
--
-- **RESTRICT** — 기록이 남은 링크는 하드 삭제되지 않는다(0126 이 종료를 `closed_at` 전환으로
-- 둔 결정과 짝이다).
--
-- 편집 이력(`response_edit_logs`)은 화면에 표시된다 — 링크 칸이 채워진 행은 「외주」로 읽는다.
-- 캠페인 쪽은 저장만 하고 표시하지 않는다.
--
-- 멱등 (IF NOT EXISTS / DO 블록) — 빈 DB 재생과 재적용 양쪽 안전.

BEGIN;

-- ── 단건 메일 ────────────────────────────────────────────────────────────────

ALTER TABLE mail_campaigns
  ADD COLUMN IF NOT EXISTS fieldwork_link_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mail_campaigns_fieldwork_link_id_fkey'
      AND conrelid = 'mail_campaigns'::regclass
  ) THEN
    ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_fieldwork_link_id_fkey
      FOREIGN KEY (fieldwork_link_id) REFERENCES survey_fieldwork_links (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'mail_campaigns_creator_exclusive_check'
      AND conrelid = 'mail_campaigns'::regclass
  ) THEN
    ALTER TABLE mail_campaigns ADD CONSTRAINT mail_campaigns_creator_exclusive_check
      CHECK (created_by IS NULL OR fieldwork_link_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS mail_campaigns_fieldwork_link_idx
  ON mail_campaigns (fieldwork_link_id)
  WHERE fieldwork_link_id IS NOT NULL;

COMMENT ON COLUMN mail_campaigns.fieldwork_link_id IS
  '이 단건 메일을 보낸 외주 실사 링크. NULL 이면 계정이 보냈다(created_by) — ADR-0027';

-- ── 응답 수정 이력 ───────────────────────────────────────────────────────────

ALTER TABLE response_edit_logs
  ADD COLUMN IF NOT EXISTS fieldwork_link_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'response_edit_logs_fieldwork_link_id_fkey'
      AND conrelid = 'response_edit_logs'::regclass
  ) THEN
    ALTER TABLE response_edit_logs ADD CONSTRAINT response_edit_logs_fieldwork_link_id_fkey
      FOREIGN KEY (fieldwork_link_id) REFERENCES survey_fieldwork_links (id) ON DELETE RESTRICT;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'response_edit_logs_editor_exclusive_check'
      AND conrelid = 'response_edit_logs'::regclass
  ) THEN
    ALTER TABLE response_edit_logs ADD CONSTRAINT response_edit_logs_editor_exclusive_check
      CHECK (edited_by IS NULL OR fieldwork_link_id IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS response_edit_logs_fieldwork_link_idx
  ON response_edit_logs (fieldwork_link_id)
  WHERE fieldwork_link_id IS NOT NULL;

COMMENT ON COLUMN response_edit_logs.fieldwork_link_id IS
  '이 수정을 한 외주 실사 링크. NULL 이면 계정이 고쳤다(edited_by) — ADR-0027';

COMMIT;
