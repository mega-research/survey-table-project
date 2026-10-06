import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/features/survey-builder/table-editor/hooks/use-table-editor';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * updateCell 의 열 단위 모바일 표시 일괄 지정 — 셀 저장과 같은 커밋에 실려야 한다.
 * 셀별 연속 갱신으로 쪼개면 편집 모달과 스토어의 이중 상태에서 일부가 조용히 유실된다.
 */
const COLUMNS: TableColumn[] = [
  { id: 'col-1', label: '직업', width: 150 },
  { id: 'col-2', label: '설명', width: 150 },
  { id: 'col-3', label: '인원', width: 150 },
];

const makeRows = (): TableRow[] =>
  ['a', 'b', 'c'].map((key) => ({
    id: `row-${key}`,
    label: '',
    height: 60,
    minHeight: 40,
    cells: [
      { id: `${key}-title`, type: 'text', content: `직업 ${key}` },
      { id: `${key}-desc`, type: 'text', content: `설명 ${key}` },
      { id: `${key}-input`, type: 'input', content: '' },
    ],
  }));

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

describe('useTableEditor.updateCell — 열 단위 모바일 표시 일괄 지정', () => {
  it('같은 열의 표시 셀에 한 번의 갱신으로 적용한다', () => {
    const { hook, onTableChange } = setup();
    const cell = hook.result.current.state.currentRows[0]!.cells[1]!;
    onTableChange.mockClear();

    act(() => {
      hook.result.current.actions.updateCell(
        0,
        1,
        { ...cell, content: '고친 설명', mobileDisplay: 'collapsed' },
        undefined,
        { columnMobileDisplay: { value: 'collapsed' } },
      );
    });

    const rows = hook.result.current.state.currentRows;
    expect(rows.map((row) => row.cells[1]!.mobileDisplay)).toEqual([
      'collapsed',
      'collapsed',
      'collapsed',
    ]);
    expect(rows[0]!.cells[1]!.content).toBe('고친 설명');
    expect(rows.flatMap((row) => [row.cells[0]!.mobileDisplay, row.cells[2]!.mobileDisplay])).toEqual(
      Array(6).fill(undefined),
    );
    expect(onTableChange).toHaveBeenCalledTimes(1);
  });

  it('옵션이 없으면 다른 셀을 건드리지 않는다', () => {
    const { hook } = setup();
    const cell = hook.result.current.state.currentRows[0]!.cells[1]!;

    act(() => {
      hook.result.current.actions.updateCell(0, 1, { ...cell, mobileDisplay: 'collapsed' });
    });

    const rows = hook.result.current.state.currentRows;
    expect(rows.map((row) => row.cells[1]!.mobileDisplay)).toEqual(['collapsed', undefined, undefined]);
  });
});

describe('useTableEditor.updateCell — 중복 불가 묶음 이름의 열 단위 일괄 지정', () => {
  const selectRows = (): TableRow[] =>
    ['a', 'b', 'c'].map((key) => ({
      id: `row-${key}`,
      label: '',
      height: 60,
      minHeight: 40,
      cells: [
        { id: `${key}-title`, type: 'text', content: `국가 ${key}` },
        { id: `${key}-2025`, type: 'select', content: '', selectOptions: [] },
        { id: `${key}-2026`, type: 'select', content: '', selectOptions: [] },
      ],
    }));

  it('같은 열의 선택 칸에 한 번의 갱신으로 적용한다', () => {
    const onTableChange = vi.fn();
    const hook = renderHook(() =>
      useTableEditor({
        tableTitle: '표 질문',
        columns: COLUMNS,
        rows: selectRows(),
        currentQuestionId: 'q1',
        questionCode: 'Q1',
        questionTitle: '표 질문',
        onTableChange,
      }),
    );
    const cell = hook.result.current.state.currentRows[0]!.cells[1]!;
    onTableChange.mockClear();

    act(() => {
      hook.result.current.actions.updateCell(
        0,
        1,
        { ...cell, distinctGroup: '2025' },
        undefined,
        { columnDistinctGroup: { value: '2025' } },
      );
    });

    const rows = hook.result.current.state.currentRows;
    expect(rows.map((row) => row.cells[1]!.distinctGroup)).toEqual(['2025', '2025', '2025']);
    expect(rows.map((row) => row.cells[2]!.distinctGroup)).toEqual([undefined, undefined, undefined]);
    expect(onTableChange).toHaveBeenCalledTimes(1);
  });
});
