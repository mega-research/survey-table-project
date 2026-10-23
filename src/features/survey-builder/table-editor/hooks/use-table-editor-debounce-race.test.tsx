import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/features/survey-builder/table-editor/hooks/use-table-editor';
import type { TableColumn, TableRow } from '@/types/survey';

/**
 * 지연 알림이 그 사이의 즉시 알림을 덮어쓰던 회귀.
 *
 * 라벨·코드 입력은 300ms 뒤에 부모(formData)로 알리는데, 예약할 때의 행·열 배열을 붙잡아 두었다.
 * 그 사이에 행 추가 같은 즉시 알림이 나가면, 뒤늦게 발화한 예약이 추가 전 배열을 다시 올려
 * 화면에는 행이 늘어 있는데 저장은 늘기 전 배열이 됐다.
 * 마지막 알림은 언제나 편집기의 지금 상태여야 한다.
 */

const COLUMNS: TableColumn[] = [
  { id: 'col-1', label: '열 1', columnCode: 'c1', width: 150 },
  { id: 'col-2', label: '열 2', columnCode: 'c2', width: 150 },
];

function makeRows(): TableRow[] {
  return [
    {
      id: 'row-1',
      label: '행 1',
      height: 60,
      minHeight: 40,
      cells: [
        { id: 'cell-1-1', content: '', type: 'text' },
        { id: 'cell-1-2', content: '', type: 'text' },
      ],
    },
  ];
}

function setup() {
  const onTableChange = vi.fn();
  const hook = renderHook(() =>
    useTableEditor({
      tableTitle: '표',
      columns: COLUMNS,
      rows: makeRows(),
      currentQuestionId: 'qT',
      questionCode: 'Q1',
      questionTitle: '표',
      onTableChange,
    }),
  );
  const lastPayload = () =>
    onTableChange.mock.calls.at(-1)?.[0] as
      | { tableRowsData: TableRow[]; tableColumns: TableColumn[] }
      | undefined;
  return { hook, onTableChange, lastPayload };
}

describe('useTableEditor — 지연 알림과 즉시 알림의 순서', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('행 라벨을 고친 직후 행을 추가해도 마지막 알림은 추가된 행과 고친 라벨을 함께 담는다', () => {
    const { hook, lastPayload } = setup();

    act(() => {
      hook.result.current.actions.updateRowLabel(0, '고친 라벨');
    });
    act(() => {
      hook.result.current.actions.addRow();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const rows = lastPayload()?.tableRowsData ?? [];
    expect(rows).toHaveLength(2);
    expect(rows[0]?.label).toBe('고친 라벨');
  });

  it('열 라벨을 고친 직후 열을 추가해도 마지막 알림은 추가된 열과 고친 라벨을 함께 담는다', () => {
    const { hook, lastPayload } = setup();

    act(() => {
      hook.result.current.actions.updateColumnLabel(0, '고친 열');
    });
    act(() => {
      hook.result.current.actions.addColumn();
    });
    act(() => {
      vi.advanceTimersByTime(1000);
    });

    const cols = lastPayload()?.tableColumns ?? [];
    expect(cols).toHaveLength(3);
    expect(cols[0]?.label).toBe('고친 열');
  });
});
