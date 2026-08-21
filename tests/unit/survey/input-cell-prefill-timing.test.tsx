import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputCell } from '@/features/question-renderer/cells/input-cell';
import { ContactAttrsProvider } from '@/lib/survey/contact-attrs-context';
import type { TableCell } from '@/types/survey';

/**
 * InputCell 의 prefill / emptyDefault 쓰기 effect 실행 횟수 박제.
 *
 * 두 effect 는 onUpdateValue 로 응답을 쓴다(→ handleResponse → draft autosave). 호출자의
 * onUpdateValue 는 셀별로 생성되어 재렌더마다 identity 가 바뀌므로, 그 identity 변경이
 * 추가 쓰기를 만들지 않아야 한다 — 트리거는 prefill 결과값 / 응답 부재 여부뿐이다.
 */
describe('InputCell prefill·emptyDefault 쓰기 횟수', () => {
  afterEach(cleanup);

  const renderCell = (cell: TableCell, cellResponse: unknown, onUpdateValue: () => void) => (
    <ContactAttrsProvider attrs={{ 회사: '메가리서치' }}>
      <InputCell cell={cell} cellResponse={cellResponse} onUpdateValue={onUpdateValue} questionId="q1" />
    </ContactAttrsProvider>
  );

  it('prefill 은 마운트 시 1회 쓰고, 새 onUpdateValue identity 로 재렌더해도 추가로 쓰지 않는다', () => {
    const cell = {
      id: 'c-prefill',
      type: 'input',
      content: '',
      defaultValueTemplate: '{{회사}}',
    } as unknown as TableCell;
    const first = vi.fn();
    const { rerender } = render(renderCell(cell, '', first));
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith('메가리서치');

    // 부모가 아직 쓰기를 반영하지 못한 채(cellResponse 그대로) 새 콜백으로 재렌더
    const second = vi.fn();
    rerender(renderCell(cell, '', second));
    expect(second).not.toHaveBeenCalled();
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('emptyDefault 는 응답 미존재(undefined)일 때만 1회 쓰고, 빈 문자열로 지운 뒤에는 쓰지 않는다', () => {
    const cell = {
      id: 'c-empty',
      type: 'input',
      content: '',
      inputType: 'number',
      emptyDefault: 0,
    } as unknown as TableCell;
    const onUpdateValue = vi.fn();
    const { rerender } = render(renderCell(cell, undefined, onUpdateValue));
    expect(onUpdateValue).toHaveBeenCalledTimes(1);
    expect(onUpdateValue).toHaveBeenCalledWith('0');

    const next = vi.fn();
    rerender(renderCell(cell, undefined, next));
    expect(next).not.toHaveBeenCalled();

    rerender(renderCell(cell, '', next));
    expect(next).not.toHaveBeenCalled();
  });
});
