import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/components/survey-builder/table-editor/hooks/use-table-editor';
import type { TableColumn, TableRow } from '@/types/survey';

const COLUMNS: TableColumn[] = [{ id: 'col-1', label: '열 1', columnCode: 'c1', width: 150 }];
const ROWS: TableRow[] = [
  { id: 'row-1', label: '행 1', height: 60, minHeight: 40, cells: [{ id: 'cell-1-1', content: '', type: 'input' }] },
];

/**
 * questionCode 변경 → 300ms 뒤 셀 코드 재발번(commitRows) → notifyChangeDebounced 가 다시 300ms 뒤
 * onTableChange 를 정확히 1회 부른다(총 600ms). 같은 값 재렌더는 0회.
 */
describe('useTableEditor questionCode 변경 debounce', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('questionCode 변경 600ms 뒤 onTableChange 1회, 같은 값 재렌더에는 0회', () => {
    const onTableChange = vi.fn();
    const { rerender } = renderHook(
      ({ questionCode }) =>
        useTableEditor({
          tableTitle: '표',
          columns: COLUMNS,
          rows: ROWS,
          currentQuestionId: 'q1',
          questionCode,
          questionTitle: '표',
          onTableChange,
        }),
      { initialProps: { questionCode: 'Q1' } },
    );
    act(() => vi.advanceTimersByTime(500));
    expect(onTableChange).not.toHaveBeenCalled();

    rerender({ questionCode: 'Q2' });
    act(() => vi.advanceTimersByTime(599));
    expect(onTableChange).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(1));
    expect(onTableChange).toHaveBeenCalledTimes(1);

    rerender({ questionCode: 'Q2' });
    act(() => vi.advanceTimersByTime(500));
    expect(onTableChange).toHaveBeenCalledTimes(1);
  });
});
