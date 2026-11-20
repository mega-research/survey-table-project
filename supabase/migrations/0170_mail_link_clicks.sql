-- 0170: 링크 클릭 — 메일 수신자가 본문의 링크를 누른 기록. (2026-11-20)
--
-- 공개 링크로 보낸 조사는 누가 응답했는지 알 수 없어 독촉 대상을 고르지 못했다
-- (.scratch/mail-link-click/PRD.md, ADR 0042). 발송 서비스의 클릭 알림(email.clicked)마다 한 줄을 넣는다.
-- 수신 상태(mail_recipients.status)와 별도 기록이다 — 한 수신자가 여러 링크를 여러 번 누른다.
--
-- link_kind: survey(우리 응답 화면 주소) · unsubscribe(수신거부) · other(그 밖의 링크).
-- link_url 은 other 만 담는다 — 설문·수신거부 주소에는 그 사람 전용 토큰이 들어 있어 남기지 않는다.
-- ip_hash 는 응답(survey_responses.ip_hash)과 같은 식의 해시다. IP 원문은 저장하지 않는다.
-- 회차·조사 대상은 수신자 행을 거쳐 읽는다(사본 열 없음). 수신자가 지워지면 함께 지워진다.
--
-- 앱 배포 전에 적용한다 — 새 앱이 쓴다. 새 표뿐이라 구버전 앱에 영향이 없어 단일 단계다.
-- 접근은 서버(service role) 전용 — RLS 활성 + anon/authenticated 권한 회수(0136·0142·0152 관례).

BEGIN;

CREATE TABLE IF NOT EXISTS public.mail_link_clicks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  recipient_id uuid NOT NULL REFERENCES public.mail_recipients(id) ON DELETE CASCADE,
  link_kind text NOT NULL,
  link_url text,
  clicked_at timestamptz NOT NULL,
  ip_hash text,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT mail_link_clicks_kind_check
    CHECK (link_kind IN ('survey', 'unsubscribe', 'other')),
  CONSTRAINT mail_link_clicks_url_only_other_check
    CHECK ((link_kind = 'other') = (link_url IS NOT NULL))
);

ALTER TABLE public.mail_link_clicks ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.mail_link_clicks FROM anon, authenticated;

CREATE INDEX IF NOT EXISTS mail_link_clicks_recipient_kind_idx
  ON public.mail_link_clicks (recipient_id, link_kind);

COMMIT;
