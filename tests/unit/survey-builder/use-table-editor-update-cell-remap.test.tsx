import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/components/survey-builder/table-editor/hooks/use-table-editor';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * updateCell 의 valueChanges 인자 배선 회귀 테스트 (Task 3).
 *
 * 배경: 셀 옵션 optionCode 편집이 value 를 동기화시키면(applyCustomOptionCode),
 * 같은 표의 다른 셀이 이 셀을 controllerCellId 로 참조하는 게이팅(enabledWhen)도
 * 같은 커밋 안에서 리매핑되어야 한다(remapGatingValues). updateCell 이 이 리매핑을
 * 자신이 교체하는 셀(cell.id)을 controller 로 삼아 정확히 수행하는지 검증한다.
 */

const COLUMNS: TableColumn[] = [
  { id: 'col-1', label: '열 1', width: 150 },
  { id: 'col-2', label: '열 2', width: 150 },
];

function makeRows(): TableRow[] {
  return [
    {
      id: 'row-1',
      label: '행 1',
      height: 60,
      minHeight: 40,
      cells: [
        {
          id: 'ctrl',
          content: '',
          type: 'radio',
          radioOptions: [
            { id: 'a', label: '옵션 A', value: 'option-1', optionCode: '1', isCustomOptionCode: true },
            { id: 'b', label: '옵션 B', value: 'option-2' },
          ],
        },
        {
          id: 'gated',
          content: '',
          type: 'input',
          enabledWhen: { kind: 'option', controllerCellId: 'ctrl', values: ['option-2'] },
        },
      ],
    },
  ];
}

function setup() {
  const onTableChange = vi.fn();
  const hook = renderHook(() =>
    useTableEditor({
      tableTitle: '표 질문',
      columns: COLUMNS,
      rows: makeRows(),
      currentQuestionId: 'q1',
      questionCode: 'Q1',
      questionTitle: '표 질문',
      onTableChange,
    }),
  );
  return { hook, onTableChange };
}

describe('useTableEditor.updateCell — 게이팅 리매핑 배선', () => {
  it('valueChanges 가 있으면 이 셀을 controller 로 참조하는 다른 셀의 enabledWhen.values 를 리매핑한다', () => {
    const { hook } = setup();

    const rows = hook.result.current.state.currentRows;
    const ctrlCell = rows[0]!.cells[0]!;
    const updatedCtrlCell = {
      ...ctrlCell,
      radioOptions: [
        ctrlCell.radioOptions![0]!,
        { ...ctrlCell.radioOptions![1]!, optionCode: '5', isCustomOptionCode: true, value: '5' },
      ],
    };

    act(() => {
      hook.result.current.actions.updateCell(0, 0, updatedCtrlCell, [
        { oldValue: 'option-2', newValue: '5' },
      ]);
    });

    const nextRows = hook.result.current.state.currentRows;
    expect(nextRows[0]!.cells[1]!.enabledWhen).toMatchObject({ values: ['5'] });
    expect(nextRows[0]!.cells[0]!.radioOptions![1]!.value).toBe('5');
  });

  it('valueChanges 가 없으면 게이팅을 건드리지 않는다', () => {
    const { hook } = setup();

    const rows = hook.result.current.state.currentRows;
    const ctrlCell = rows[0]!.cells[0]!;

    act(() => {
      hook.result.current.actions.updateCell(0, 0, { ...ctrlCell, content: '수정됨' });
    });

    const nextRows = hook.result.current.state.currentRows;
    expect(nextRows[0]!.cells[1]!.enabledWhen).toMatchObject({ values: ['option-2'] });
  });

  it('다른 컨트롤러를 참조하는 게이팅은 리매핑되지 않는다', () => {
    const { hook } = setup();

    // gated 셀 자신을 업데이트(다른 셀의 controller 는 아님) — 영향 없어야 함
    const rows = hook.result.current.state.currentRows;
    const gatedCell = rows[0]!.cells[1]!;

    act(() => {
      hook.result.current.actions.updateCell(0, 1, { ...gatedCell, content: '변경' }, [
        { oldValue: 'option-2', newValue: '5' },
      ]);
    });

    const nextRows = hook.result.current.state.currentRows;
    // controllerCellId 는 'ctrl' 인데 이번 업데이트의 cell.id 는 'gated' 이므로 매칭 없음
    expect(nextRows[0]!.cells[1]!.enabledWhen).toMatchObject({ values: ['option-2'] });
  });
});
