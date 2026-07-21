-- scripts/backfill-contact-invite-code.ts 로 전 행을 채운 뒤 NOT NULL 을 고정한다.
-- (Drizzle 스키마는 이미 invite_code 를 .notNull() 로 선언 — DB 를 그에 맞춘다.)
ALTER TABLE contact_targets ALTER COLUMN invite_code SET NOT NULL;
