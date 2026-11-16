import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/features/survey-builder/table-editor/hooks/use-table-editor';
import type { TableCell, TableColumn, TableRow } from '@/types/survey';

/**
 * 따라 선택 짝(CONTEXT.md)이 칸을 복사하는 길에서 남의 칸을 가리키지 않게 한다.
 *
 * 짝은 대개 「같은 행의 옆 칸」이다. 행을 복제하면 복제본은 제 행의 칸을 가리켜야 하고,
 * 칸 하나만 다른 자리에 붙이면 원본의 짝(원본 행의 칸)을 그대로 끌고 가면 안 된다 —
 * 2행의 수혜를 체크했는데 1행의 지원이 체크되는 표가 된다.
 */
const columns: TableColumn[] = [
  { id: 'c-know', label: '알고 있음', width: 120 },
  { id: 'c-apply', label: '지원 경험 있음', width: 120 },
  { id: 'c-benefit', label: '수혜 경험 있음', width: 120 },
];
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
        // 같은 행의 지원 + 다른 행의 알고 있음
        opt('benefit1', 'g-benefit', { impliedCellIds: ['apply1', 'know2'] }),
      ],
    },
    {
      id: 'r2',
      label: '② 인력',
      cells: [opt('know2', 'g-know'), opt('apply2', 'g-apply'), opt('benefit2', 'g-benefit')],
    },
  ];
}

function setup() {
  const onTableChange = vi.fn();
  const hook = renderHook(() =>
    useTableEditor({
      tableTitle: '표',
      columns,
      rows: makeRows(),
      currentQuestionId: 'q1',
      questionCode: 'C7',
      questionTitle: '표',
      onTableChange,
    }),
  );
  const rows = () => hook.result.current.state.currentRows as TableRow[];
  return { hook, rows };
}

describe('useTableEditor — 따라 선택 짝과 칸 복사', () => {
  it('행을 복제하면 같은 행을 가리키던 짝은 복제 행의 칸으로 옮기고, 다른 행을 가리키던 짝은 그대로 둔다', () => {
    const { hook, rows } = setup();
    act(() => {
      hook.result.current.actions.duplicateRow(0);
    });
    const copy = rows()[1]!;
    const [know, apply, benefit] = copy.cells;
    expect(apply!.impliedCellIds).toEqual([know!.id]);
    expect(benefit!.impliedCellIds).toEqual([apply!.id, 'know2']);
    // 원본 행은 그대로다
    expect(rows()[0]!.cells[2]!.impliedCellIds).toEqual(['apply1', 'know2']);
  });

  it('칸 하나를 다른 자리에 붙여넣으면 짝은 따라가지 않는다', () => {
    const { hook, rows } = setup();
    act(() => {
      hook.result.current.actions.copyCell(0, 2);
    });
    act(() => {
      hook.result.current.actions.pasteCell(1, 2);
    });
    const pasted = rows()[1]!.cells[2]!;
    expect(pasted.id).toBe('benefit2');
    expect(pasted.type).toBe('choice_opt');
    expect(pasted).not.toHaveProperty('impliedCellIds');
  });
});
