import { act, renderHook } from '@testing-library/react';
import { toast } from 'sonner';
import { describe, expect, it, vi } from 'vitest';

import { useTableEditor } from '@/features/survey-builder/table-editor/hooks/use-table-editor';
import type { TableColumn, TableRow } from '@/types/survey';

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }));

/**
 * 열 차례로 열기 — 보기·순위 옵션 칸이 든 열에는 단계를 걸지 못한다. 그 칸의 선택은 칸 값이 아닌
 * 보기 그룹 맵에 살아, 열린 단계 파생·닫을 때 비우기가 선택을 보지 못한다(행 차례로 열기와 같은 제외).
 */
const COLUMNS: TableColumn[] = [
  { id: 'col-1', label: '항목' },
  { id: 'col-2', label: '보기' },
  { id: 'col-3', label: '기타 원료명' },
];
const ROWS: TableRow[] = [
  {
    id: 'r1',
    label: '',
    cells: [
      { id: 'a', type: 'text', content: '항목' },
      { id: 'b', type: 'choice_opt', content: '보기' },
      { id: 'c', type: 'input', content: '' },
    ],
  },
];

function setup() {
  const onTableChange = vi.fn();
  const hook = renderHook(() =>
    useTableEditor({
      tableTitle: '표',
      columns: COLUMNS,
      rows: ROWS,
      currentQuestionId: 'q1',
      questionCode: 'Q1',
      questionTitle: '표',
      onTableChange,
    }),
  );
  return { hook, onTableChange };
}

describe('useTableEditor.updateColumnReveal — 단계를 걸 수 없는 열', () => {
  it('보기 옵션 칸이 든 열의 2단계 이상은 저장하지 않고 이유를 알린다', () => {
    const { hook, onTableChange } = setup();
    onTableChange.mockClear();
    act(() => hook.result.current.actions.updateColumnReveal(1, { revealStep: 2 }));
    expect(hook.result.current.state.currentColumns[1]!.revealStep).toBeUndefined();
    expect(onTableChange).not.toHaveBeenCalled();
    expect(vi.mocked(toast.error)).toHaveBeenCalledTimes(1);
  });

  it('응답 칸만 든 열은 그대로 저장한다', () => {
    const { hook } = setup();
    act(() => hook.result.current.actions.updateColumnReveal(2, { revealStep: 2 }));
    expect(hook.result.current.state.currentColumns[2]!.revealStep).toBe(2);
  });
});
