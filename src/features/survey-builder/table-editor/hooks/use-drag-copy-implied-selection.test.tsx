import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDragCopy } from '@/features/survey-builder/table-editor/hooks/use-drag-copy';
import type { TableCell, TableColumn, TableRow } from '@/types/survey';

/**
 * 영역 붙여넣기와 따라 선택 짝(CONTEXT.md) — 복사한 영역 안을 가리키던 짝은 붙여넣은 자리의
 * 같은 위치 칸으로 옮기고, 영역 밖을 가리키던 짝은 뺀다(원본 행의 칸을 끌고 가지 않는다).
 */
const opt = (id: string, group: string, extra: Partial<TableCell> = {}): TableCell => ({
  id,
  type: 'choice_opt',
  content: '',
  choiceGroupId: group,
  ...extra,
});
function makeRows(): TableRow[] {
  return [
    {
      id: 'r1',
      label: '① 금융',
      cells: [
        opt('know1', 'g-know'),
        opt('apply1', 'g-apply', { impliedCellIds: ['know1'] }),
        opt('benefit1', 'g-benefit', { impliedCellIds: ['apply1'] }),
      ],
    },
    {
      id: 'r2',
      label: '② 인력',
      cells: [opt('know2', 'g-know'), opt('apply2', 'g-apply'), opt('benefit2', 'g-benefit')],
    },
  ];
}
const columns = [
  { id: 'c1', label: '알고 있음' },
  { id: 'c2', label: '지원 경험 있음' },
  { id: 'c3', label: '수혜 경험 있음' },
] as TableColumn[];

function setup() {
  let rows = makeRows();
  const currentRowsRef = { current: rows };
  const setCurrentRows = (next: TableRow[]) => {
    rows = next;
    currentRowsRef.current = next;
  };
  const hook = renderHook(() =>
    useDragCopy({
      currentRowsRef,
      currentColumnsRef: { current: columns },
      questionCodeRef: { current: undefined },
      setCurrentRows,
      notifyChange: () => {},
      currentTitleRef: { current: '' },
      recalculateHiddenCells: (r) => r,
      clearCopiedCell: () => {},
    }),
  );
  return { hook, getRows: () => rows };
}
const cellById = (rows: TableRow[], id: string) =>
  rows.flatMap((row) => row.cells).find((cell) => cell.id === id)!;

describe('영역 붙여넣기 — 따라 선택 짝', () => {
  it('영역 안을 가리키던 짝은 붙여넣은 자리의 같은 위치로 옮기고, 영역 밖을 가리키던 짝은 뺀다', () => {
    const { hook, getRows } = setup();

    // 1행의 지원·수혜 두 칸을 복사해 2행의 같은 열에 붙인다 (알고 있음 칸은 영역 밖)
    act(() => hook.result.current.startDragCopy(0, 1));
    act(() => hook.result.current.updateDragCopyRange(0, 2));
    act(() => {
      hook.result.current.storeSelectedRegion();
    });
    act(() => {
      const result = hook.result.current.pasteRegion(1, 1);
      expect('success' in result && result.success).toBe(true);
    });

    // 수혜 → 지원은 영역 안이라 2행의 지원으로
    expect(cellById(getRows(), 'benefit2').impliedCellIds).toEqual(['apply2']);
    // 지원 → 알고 있음은 영역 밖(1행의 칸)이라 뺀다
    expect(cellById(getRows(), 'apply2')).not.toHaveProperty('impliedCellIds');
    // 원본은 그대로다
    expect(cellById(getRows(), 'apply1').impliedCellIds).toEqual(['know1']);
  });
});
