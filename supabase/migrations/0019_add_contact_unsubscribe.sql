-- contact_targets: 수신거부 컬럼 추가
-- unsubscribed_at: 해지 시각 (NULL 이면 구독 상태)
-- unsubscribe_token: 수신거부 링크용 일회용 UUID. inviteToken 과 분리해
--   token 누출 시 응답 흐름과 차단 흐름이 cross-route 되지 않도록 함.

ALTER TABLE contact_targets
  ADD COLUMN unsubscribed_at timestamptz,
  ADD COLUMN unsubscribe_token uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX contact_targets_unsubscribe_token_unique
  ON contact_targets(unsubscribe_token);
