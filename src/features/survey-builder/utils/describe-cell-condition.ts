/**
 * 표 칸 조건(`CellEnableCondition`)을 빌더에서 읽을 글로 — 「설립연도_년 ≠ 9999 그리고 설립연도_월 ≠ 99」.
 *
 * 표 제약의 적용 조건(`SumConstraint.when`)은 편집 화면이 없고 스크립트로만 넣는다. 저작자가 무엇이
 * 걸려 있는지 보게 하려고 쓴다. 칸 이름은 엑셀 라벨 → 같은 행 앞 글자 칸 → 셀 코드 → id 앞 6자 순.
 */
import type { CellEnableCondition, TableCell, TableRow } from '@/types/survey';
import { tableInputCellLabels } from '@/utils/table-input-cell-labels';

const NUMERIC_OP: Record<string, string> = {
  '>': '>',
  '>=': '≥',
  '<': '<',
  '<=': '≤',
  '==': '=',
  '!=': '≠',
};

const NAMED_CELL_TYPES: TableCell['type'][] = [
  'input',
  'radio',
  'select',
  'checkbox',
  'choice_opt',
];

export function describeCellCondition(
  condition: CellEnableCondition,
  rows: readonly TableRow[],
): string {
  const cells = new Map(rows.flatMap((row) => row.cells.map((cell) => [cell.id, cell] as const)));
  const rowLabels = tableInputCellLabels(rows, NAMED_CELL_TYPES);
  const nameOf = (id: string) => {
    const cell = cells.get(id);
    if (!cell) return '(지워진 칸)';
    return cell.exportLabel?.trim() || rowLabels.get(id) || cell.cellCode || id.slice(0, 6);
  };
  const optionLabel = (id: string, value: string) => {
    const cell = cells.get(id);
    const options = [
      ...(cell?.radioOptions ?? []),
      ...(cell?.checkboxOptions ?? []),
      ...(cell?.selectOptions ?? []),
    ];
    return options.find((o) => o.value === value || o.id === value)?.label ?? value;
  };

  const walk = (c: CellEnableCondition, nested: boolean): string => {
    switch (c.kind) {
      case 'numeric':
        return `${nameOf(c.controllerCellId)} ${NUMERIC_OP[c.op] ?? c.op} ${c.value}`;
      case 'filled':
        return `${nameOf(c.controllerCellId)} 입력함`;
      case 'choice-selected':
        return `${nameOf(c.controllerCellId)} 선택함`;
      case 'option':
        return `${nameOf(c.controllerCellId)} = 「${c.values.map((v) => optionLabel(c.controllerCellId, v)).join('·')}」`;
      case 'group': {
        if (c.terms.length === 0) return '조건 없음';
        const parts = c.terms.map((t) => walk(t, true));
        if (c.op === 'NOT') return `다음 중 하나도 아님(${parts.join(', ')})`;
        const joined = parts.join(c.op === 'AND' ? ' 그리고 ' : ' 또는 ');
        return nested && c.terms.length > 1 ? `(${joined})` : joined;
      }
    }
  };
  return walk(condition, false);
}
