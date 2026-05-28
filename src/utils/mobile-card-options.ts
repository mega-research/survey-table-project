import type { TableCell } from '@/types/survey';

const LABEL_WRAP_THRESHOLD = 10;

/**
 * 모바일 카드(RowCard) 안 옵션 그리드의 열 수 결정.
 * - 옵션 라벨 최댓값이 LABEL_WRAP_THRESHOLD 초과면 1열, 이하면 2열.
 * - 옵션 없는 셀(input 등)은 0 반환 — 호출자가 분기에 사용.
 */
export function computeMobileCardOptionsColumns(cell: TableCell): number {
  const opts =
    cell.radioOptions ?? cell.checkboxOptions ?? cell.selectOptions ?? [];
  if (opts.length === 0) return 0;
  const longest = opts.reduce(
    (max, o) => Math.max(max, o.label?.length ?? 0),
    0,
  );
  return longest > LABEL_WRAP_THRESHOLD ? 1 : 2;
}

/**
 * 카드 안 셀의 optionsColumns 를 라벨 길이 휴리스틱으로 override.
 * 옵션이 없거나 이미 같은 값이면 원본 cell 그대로 반환 (참조 보존).
 */
export function overrideCellOptionsColumnsForCard<T extends TableCell>(cell: T): T {
  const cols = computeMobileCardOptionsColumns(cell);
  if (cols === 0 || cell.optionsColumns === cols) return cell;
  return { ...cell, optionsColumns: cols };
}

/**
 * 열 라벨이 "_단위" 또는 "단위" 로 끝나는 셀쌍(수량 셀 + 단위 셀)을 한 줄로 묶기 위한 감지 헬퍼.
 * 다음 셀의 열 라벨을 받아 묶을지 여부와, 현재 셀이 이미 묶인 단위 셀인지 반환.
 */
export function detectUnitPair(
  currentLabel: string,
  nextLabel: string | undefined,
  prevLabel: string | undefined,
): { isUnitPairStart: boolean; wasAlreadyPaired: boolean } {
  const isUnitPairStart =
    !!nextLabel && (nextLabel.endsWith('_단위') || nextLabel.endsWith('단위'));
  const isUnitCell =
    currentLabel.endsWith('_단위') || currentLabel === '단위';
  const wasAlreadyPaired =
    isUnitCell &&
    ((prevLabel ? prevLabel + '_단위' === currentLabel : false) ||
      currentLabel === '단위');
  return { isUnitPairStart, wasAlreadyPaired };
}
