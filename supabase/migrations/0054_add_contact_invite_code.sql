-- contact_targets.invite_code: /i/{code} 짧은 초대 URL 용 코드.
-- inviteToken(UUID)은 그대로 유지하고 이 컬럼은 앱에서 nanoid(10)로 생성한다.
-- 기존 행은 scripts/backfill-contact-invite-code.ts 로 채운 뒤 0055 에서 NOT NULL 을 건다.
-- UNIQUE 인덱스는 다중 NULL 을 허용하므로 backfill 이전에 생성해도 안전하다.
ALTER TABLE contact_targets ADD COLUMN IF NOT EXISTS invite_code text;

CREATE UNIQUE INDEX IF NOT EXISTS contact_targets_invite_code_unique
  ON contact_targets (invite_code);
