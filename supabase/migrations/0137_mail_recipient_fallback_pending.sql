-- 메일 대체 발송 처리 대기 표식 (2026-10-19).
--
-- 수신자가 반송·거부(failed)로 바뀌는 트랜잭션 안에서 fallback_pending_at 을 찍고,
-- 대체 발송 처리(대체 회차에 넣거나 보내지 않기로 판정)가 커밋될 때 같은 트랜잭션에서 지운다.
-- 그 사이 DB 오류나 프로세스 종료로 처리가 빠지면 정기 점검(mailFallbackSweeper)이 표식이
-- 오래 남은 행을 다시 처리한다. 전에는 상태 전이와 대체 발송 등록이 다른 트랜잭션이라
-- 뒤쪽이 실패하면 webhook 중복 제거 때문에 다시 시도할 길이 없었다.
--
-- 이전 행은 NULL 이다 — 이미 처리가 끝난 것으로 본다.

ALTER TABLE public.mail_recipients
  ADD COLUMN IF NOT EXISTS fallback_pending_at timestamptz;

CREATE INDEX IF NOT EXISTS mail_recipients_fallback_pending_idx
  ON public.mail_recipients (fallback_pending_at)
  WHERE fallback_pending_at IS NOT NULL;
