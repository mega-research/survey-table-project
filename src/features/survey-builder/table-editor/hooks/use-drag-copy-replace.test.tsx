import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useDragCopy } from '@/features/survey-builder/table-editor/hooks/use-drag-copy';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * 영역 붙여넣기는 대상 칸을 원본 칸으로 갈아 끼운다 (CONTEXT.md 「셀 필드 정책」).
 *
 * 전에는 대상 칸 위에 원본 속성을 덮어 합쳐, 원본에 없는 대상의 옛 속성(게이팅·필수·
 * 숫자 서식·SPSS 타입)이 붙여넣은 칸에 남았다. 단일 칸 붙여넣기는 처음부터 `{ ...원본, id }` 였다.
 */

function makeRows(): TableRow[] {
  return [
    {
      id: 'r-src',
      label: '소스',
      cells: [
        {
          id: 'ctrl',
          type: 'checkbox',
          content: '',
          checkboxOptions: [{ id: 'o1', label: '예', value: '1' }],
        },
        { id: 'src-input', type: 'input', content: '', inputType: 'text' },
      ],
    },
    {
      id: 'r-dst',
      label: '대상',
      cells: [
        { id: 'dst-ctrl', type: 'text', content: '' },
        {
          id: 'dst-input',
          type: 'input',
          content: '',
          inputType: 'number',
          numberFormat: { thousandSeparator: true },
          emptyDefault: 0,
          required: true,
          requiredMessage: '옛 문구',
          enabledWhen: { kind: 'filled', controllerCellId: 'ctrl' },
          requiredWhenEnabled: true,
          spssVarType: 'Numeric',
          spssMeasure: 'Continuous',
          backgroundColor: '#ff0000',
        },
      ],
    },
  ] as TableRow[];
}

const columns: TableColumn[] = [
  { id: 'c1', label: '1' },
  { id: 'c2', label: '2' },
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

function cellById(rows: TableRow[], id: string) {
  return rows.flatMap((r) => r.cells).find((c) => c.id === id);
}

describe('영역 붙여넣기 — 대상 칸 갈아 끼우기', () => {
  it('원본에 없는 대상의 옛 속성이 남지 않는다', () => {
    const { hook, getRows } = setup();

    act(() => hook.result.current.startDragCopy(0, 1));
    act(() => {
      hook.result.current.storeSelectedRegion();
    });
    act(() => {
      const result = hook.result.current.pasteRegion(1, 1);
      expect('success' in result && result.success).toBe(true);
    });

    const pasted = cellById(getRows(), 'dst-input');
    expect(pasted?.inputType).toBe('text');
    for (const key of [
      'numberFormat',
      'emptyDefault',
      'required',
      'requiredMessage',
      'enabledWhen',
      'requiredWhenEnabled',
      'backgroundColor',
    ] as const) {
      expect(pasted).not.toHaveProperty(key);
    }
    // SPSS 타입은 원본에 없으니 대상의 옛 값이 아니라 새 유형에서 다시 추론한다
    expect(pasted?.spssVarType).toBe('String');
  });
});
