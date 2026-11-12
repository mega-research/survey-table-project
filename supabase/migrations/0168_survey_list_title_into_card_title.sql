-- 0168: 운영(hotfix)이 따로 넣은 카드 제목 열 list_title(0167)의 값을 정식 열 card_title(0140)로 옮긴다 (2026-11-12)
--
-- 카드 제목은 staging 에서 card_title(0140)로 먼저 만들어졌고, 운영은 그 병합 전에 같은 기능을
-- list_title(0167)로 따로 넣었다. 병합 뒤 앱은 card_title 만 읽고 쓴다. 운영에서 담당자가 지어 둔
-- 이름(list_title)을 잃지 않도록 card_title 로 옮긴다.
--
-- 승격 순서: 0140(card_title 추가 + 설문지 제목 백필) 뒤, **앱 배포 전**. 0140 의 백필은 모든 행에
-- 설문지 제목을 넣으므로, 그 뒤에 이 파일이 담당자가 지은 이름으로 덮어야 한다 — 순서가 바뀌면
-- 0140 은 card_title 이 이미 찬 행을 건너뛰어 결과는 같지만, 이 파일이 0140 보다 먼저면 열이 없어 실패한다.
-- 배포 뒤 0169 가 list_title 을 지운다.
--
-- list_title 이 없는 DB(스테이징 — 0167 을 적용한 적이 없다)에서는 아무것도 하지 않는다.
-- 빈 DB 재생에서는 0167 이 만든 빈 열을 읽으므로 옮길 행이 없다.

BEGIN;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'surveys' AND column_name = 'list_title'
  ) THEN
    UPDATE public.surveys
    SET card_title = btrim(list_title)
    WHERE list_title IS NOT NULL AND length(btrim(list_title)) > 0;
  END IF;
END
$$;

COMMIT;
