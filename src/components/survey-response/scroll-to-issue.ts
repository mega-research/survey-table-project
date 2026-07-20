/**
 * 차단형 검증 위반 셀(data-cell-id)로 스크롤한다.
 * 응답 페이지 표의 오류 배너 "위치로 이동" 버튼이 호출한다 — 자동 스크롤 대신
 * 사용자가 명시적으로 눌러 위반 셀을 화면 중앙으로 가져오게 한다.
 *
 * cellIds 는 위반 제약의 셀 목록이다. 그중 일부는 열 displayCondition 으로 숨겨져
 * DOM 에 렌더되지 않을 수 있다(합계 검증은 allResponses 접근이 없어 숨은 열 셀을
 * 못 거르므로 cellIds[0] 이 숨은 열일 수 있다). 따라서 순서대로 훑어 실제로 렌더된
 * 첫 셀로 스크롤한다.
 */
export function scrollToCell(cellIds: readonly string[]): void {
  for (const id of cellIds) {
    const el = document.querySelector<HTMLElement>(`[data-cell-id="${id}"]`);
    if (el) {
      el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }
  }
}
