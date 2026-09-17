import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDragCopy } from '@/features/survey-builder/table-editor/hooks/use-drag-copy';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * 회귀 테스트: 영역 붙여넣기 undo 의 숨김 상태 복원.
 *
 * isHidden 은 붙여넣기 커밋 시 patch 밖(recalculateHiddenCells)에서 재계산되므로,
 * patch 복원만 하면 붙여넣은 병합 앵커가 덮었던 컨트롤러가 undo 후에도 숨김으로
 * 남는다 — 게이팅 참조는 복원됐는데 컨트롤러는 응답 불가인 반쪽 복원.
 * undo 도 복원된 스팬 기하 기준으로 isHidden 을 재계산해야 한다.
 */

// use-table-editor 의 recalculateHiddenCells 와 동일 의미 (스팬 커버리지 기반 전면 재계산)
function recalcHidden(tableRows: TableRow[]): TableRow[] {
  const hidden = new Set<string>();
  tableRows.forEach((row, r) => {
    row.cells.forEach((cell, c) => {
      const rs = cell.rowspan || 1;
      const cs = cell.colspan || 1;
      if (rs <= 1 && cs <= 1) return;
      for (let dr = 0; dr < rs; dr++) {
        for (let dc = 0; dc < cs; dc++) {
          if (dr === 0 && dc === 0) continue;
          hidden.add(`${r + dr},${c + dc}`);
        }
      }
    });
  });
  return tableRows.map((row, r) => ({
    ...row,
    cells: row.cells.map((cell, c) => ({ ...cell, isHidden: hidden.has(`${r},${c}`) })),
  }));
}

function makeRows(): TableRow[] {
  return [
    {
      id: 'r-src',
      label: '소스',
      cells: [
        { id: 'src-a', type: 'text', content: '병합', colspan: 2 },
        { id: 'src-b', type: 'text', content: '', isHidden: true },
        { id: 'src-c', type: 'text', content: '' },
      ],
    },
    {
      id: 'r-dst',
      label: '대상',
      cells: [
        { id: 'A', type: 'text', content: '' },
        {
          id: 'ctrl',
          type: 'radio',
          content: '',
          radioOptions: [{ id: 'o1', label: '수행', value: '1' }],
        },
        {
          id: 'gated',
          type: 'input',
          content: '',
          enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['1'] },
          requiredWhenEnabled: true,
        },
      ],
    },
  ] as TableRow[];
}

const columns: TableColumn[] = [
  { id: 'c1', label: '1' },
  { id: 'c2', label: '2' },
  { id: 'c3', label: '3' },
] as TableColumn[];

function setup() {
  let rows = recalcHidden(makeRows());
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
      recalculateHiddenCells: recalcHidden,
      clearCopiedCell: () => {},
    }),
  );
  return { hook, getRows: () => rows };
}

function cellById(rows: TableRow[], id: string) {
  return rows.flatMap((r) => r.cells).find((c) => c.id === id);
}

describe('영역 붙여넣기 undo — 컨트롤러 숨김 상태 복원', () => {
  it('붙여넣기로 덮인 컨트롤러가 undo 후 게이팅 참조와 함께 다시 보인다', () => {
    const { hook, getRows } = setup();

    // 병합 앵커(colspan 2)가 포함된 (0,0)-(0,1) 영역 복사
    act(() => hook.result.current.startDragCopy(0, 0));
    act(() => hook.result.current.updateDragCopyRange(0, 1));
    act(() => {
      hook.result.current.storeSelectedRegion();
    });

    // 대상 행 (1,0)에 붙여넣기 → 앵커가 col1 의 ctrl 을 덮는다
    act(() => {
      const result = hook.result.current.pasteRegion(1, 0);
      expect('success' in result && result.success).toBe(true);
    });

    const afterPaste = getRows();
    expect(cellById(afterPaste, 'ctrl')?.isHidden).toBe(true);
    // 영역 밖 gated 셀: 새로 숨겨진 컨트롤러 참조가 정리됨
    expect(cellById(afterPaste, 'gated')?.enabledWhen).toBeUndefined();

    act(() => {
      hook.result.current.undoPaste();
    });

    const afterUndo = getRows();
    // 게이팅 참조와 조건부 필수 복원
    expect(cellById(afterUndo, 'gated')?.enabledWhen).toEqual({
      kind: 'option',
      controllerCellId: 'ctrl',
      values: ['1'],
    });
    expect(cellById(afterUndo, 'gated')?.requiredWhenEnabled).toBe(true);
    // 컨트롤러 숨김 상태도 복원 — patch 만으로는 남던 stale isHidden 이 재계산으로 풀린다
    expect(cellById(afterUndo, 'ctrl')?.isHidden).toBe(false);
    expect(cellById(afterUndo, 'ctrl')?.type).toBe('radio');
  });
});
