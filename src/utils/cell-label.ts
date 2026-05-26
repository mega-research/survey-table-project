/**
 * 빌더의 표시 조건 / 장기 계산식 / 비교 좌변 등 셀 selector 라벨 공통 포맷.
 * 우선순위: exportLabel → cellCode → id slice(0,6) 폴백.
 */
export function formatCellLabel(cell: {
  id: string;
  cellCode?: string;
  exportLabel?: string;
}): string {
  return cell.exportLabel ?? cell.cellCode ?? cell.id.slice(0, 6);
}
