-- 0140: 설문 카드 제목 — 관리용 이름을 설문지 제목과 분리한다 (2026-10-21)
--
-- 설문지 제목(title)은 응답자에게 보이는 이름이고, 카드 제목(card_title)은 설문 목록 카드와
-- 운영 콘솔 머리에 보이는 관리용 이름이다. 같은 설문지를 여러 번 돌리거나(「2026 1차」) 응답자
-- 제목이 길 때 내부에서 부를 이름이 따로 필요하다.
--
-- NULL 이면 설문지 제목을 그대로 쓴다(화면의 폴백). 새 설문은 NULL 로 만들어진다 — 빌더가
-- 기본 제목으로 먼저 행을 만들고 나중에 제목을 고치므로, 생성 시점에 복사하면 카드 제목이
-- 기본 제목으로 굳는다. 기존 설문은 지금 제목을 그대로 복사해 둔다(사용자 결정 2026-10-21).
--
-- 빈 문자열은 받지 않는다 — 화면이 비우면 NULL 로 보낸다(설문지 제목을 따라간다).

BEGIN;

ALTER TABLE public.surveys ADD COLUMN IF NOT EXISTS card_title text;

ALTER TABLE public.surveys DROP CONSTRAINT IF EXISTS surveys_card_title_not_blank;
ALTER TABLE public.surveys
  ADD CONSTRAINT surveys_card_title_not_blank CHECK (card_title IS NULL OR length(btrim(card_title)) > 0);

UPDATE public.surveys SET card_title = title WHERE card_title IS NULL;

COMMIT;
