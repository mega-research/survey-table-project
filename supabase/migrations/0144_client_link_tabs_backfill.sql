-- 0144: 클라이언트 링크 칩 셋 — 칩 이전 행에 설문 보기·상세 통계를 켜 둔다. (2026-10-27)
--
-- 클라이언트 링크의 화면 칩이 넷(응답 현황·진척 보고·조사 대상·쿼터)에서 일곱으로 늘었다 —
-- 설문 보기(`preview`) · 상세 통계(`overviewDetail`) · 응답 내역(`responses`).
-- (`.scratch/client-link-response-list`, 정규화는 shared/contracts/workspace 의 normalizeClientLinkTabs)
--
-- 정규화가 「객체인데 키가 없으면 false」라, 칩 이전에 저장된 행은 그대로 두면 설문 보기와
-- 상세 통계가 **조용히 꺼진다**. 그 둘은 칩이 생기기 전에 언제나 보이던 것이라 켜 둔다.
-- 응답 내역은 채우지 않는다 — 새로 여는 데이터는 연구원이 명시로만 연다.
--
-- 이미 있는 키는 덮지 않는다(`기본값 || 기존값` — 오른쪽이 이긴다). 그래서 재적용해도
-- 연구원이 끈 칩이 되살아나지 않는다. NULL 행은 건드리지 않는다 — 정규화가 새 기본값으로 읽는다.
--
-- 배포: 앱보다 먼저 적용한다. 옛 앱은 아는 네 키만 읽어 새 키를 무시한다. 앱이 먼저 나가면
-- 이 파일을 적용하기 전까지 기존 링크의 두 칩이 꺼져 보인다(좁아지는 쪽이라 새지는 않는다).
-- 빈 DB 재생에서는 0행이다.
UPDATE survey_access_links
SET client_tabs = '{"preview": true, "overviewDetail": true}'::jsonb || client_tabs
WHERE kind = 'client'
  AND client_tabs IS NOT NULL;
