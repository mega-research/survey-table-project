import { useMediaQuery } from '@/hooks/use-media-query';

/**
 * 패드 폭 — 768px 이상 1024px 미만(md 이상 lg 미만). 창 폭만 본다: 가로로 눕힌 패드(1024px 이상)는
 * 데스크톱으로 친다(2026-11-24 사용자 결정 — 터치 기기 여부로 가리는 안은 고르지 않았다).
 */
const TABLET_WIDTH_QUERY = '(min-width: 768px) and (max-width: 1023px)';

/**
 * 이 표를 지금 화면 폭에 맞춰 줄일 것인가 — 문항 설정 `fitTableToWidth` 를 켰고 창이 패드 폭일 때만.
 *
 * - 데스크톱(1024px 이상)은 켜 두어도 지정한 px 그대로 그린다. 창이 표보다 좁으면 가로 스크롤이고 좌측 고정 열도
 *   다시 쓴다 — 넓힌 열 폭이 창 폭에 따라 비율로 바뀌어 저작자가 넣은 숫자와 화면이 어긋났다(2026-11-24 사용자 결정,
 *   그전에는 모바일이 아니면 늘 줄였다).
 * - 휴대폰(768px 미만)은 모바일 표시 방식을 따른다 — 원본 표까지 줄이면 칸이 찌그러진다.
 *
 * 표를 그리는 두 컴포넌트(TablePreview · InteractiveTableResponse)가 이 훅 하나로 판정한다. 좌측 고정 열·열 페이징·
 * 본문 표식(`fitTableMarker`)·grid 폭(`resolveTableGridSizing`)이 모두 이 값을 따르므로 따로 계산하지 말 것.
 */
export function useFitTableToWidth(fitTableToWidth: boolean): boolean {
  const isTabletWidth = useMediaQuery(TABLET_WIDTH_QUERY);
  return fitTableToWidth && isTabletWidth;
}
