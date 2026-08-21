import { act, renderHook } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { useCellForm } from '@/features/survey-builder/table-editor/cell-editor/hooks/use-cell-form';
import type { TableCell } from '@/types/survey';

/**
 * hydrate 트리거는 isOpen / cell.id 뿐이다. 모달이 열린 동안 같은 id 의 새 cell 객체가
 * 내려와도(셀 저장 → store 부분 갱신) 편집 중인 로컬 폼을 store 값으로 되돌리면 안 된다.
 */
describe('useCellForm hydrate 시점', () => {
  const cellA = { id: 'c1', type: 'text', content: 'A' } as unknown as TableCell;

  it('같은 id 의 다른 cell 객체로 재렌더해도 편집 중인 폼을 유지하고, id 가 바뀌면 hydrate 한다', () => {
    const { result, rerender } = renderHook(({ cell, isOpen }) => useCellForm(cell, isOpen), {
      initialProps: { cell: cellA, isOpen: true },
    });
    act(() => {
      result.current.setters.setTextContent('편집 중');
    });
    expect(result.current.form.textContent).toBe('편집 중');

    rerender({ cell: { ...cellA, content: 'store 갱신' } as TableCell, isOpen: true });
    expect(result.current.form.textContent).toBe('편집 중');

    const cellB = { id: 'c2', type: 'text', content: 'B' } as unknown as TableCell;
    rerender({ cell: cellB, isOpen: true });
    expect(result.current.form.textContent).toBe('B');
  });
});
