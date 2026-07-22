BEGIN;

ALTER TABLE mail_recipients
  ADD COLUMN IF NOT EXISTS send_attempted_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_lease_token uuid,
  ADD COLUMN IF NOT EXISTS send_lease_expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS send_payload_snapshot jsonb;

CREATE INDEX IF NOT EXISTS mail_recipients_dispatch_recovery_idx
  ON mail_recipients(campaign_id, send_lease_expires_at)
  WHERE status = 'sending' AND resend_message_id IS NULL;

COMMIT;
