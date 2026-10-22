import type { TableRow } from '@/types/survey';
import { tableInputCellLabels } from '@/utils/table-input-cell-labels';

export interface LookupFillTarget {
  cellId: string;
  label: string;
}

/**
 * 「목록에서 찾기」 채울 칸 후보 — 같은 표의 응답자가 보는 입력 칸(자기 자신 제외).
 * 이름 규칙은 tableInputCellLabels(같은 행 앞 글자 칸 첫 줄 → 행 이름 → 위치)다.
 */
export function listLookupFillTargets(
  rows: readonly TableRow[],
  ownCellId: string,
): LookupFillTarget[] {
  return [...tableInputCellLabels(rows)]
    .filter(([cellId]) => cellId !== ownCellId)
    .map(([cellId, label]) => ({ cellId, label }));
}
