import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { InputCell } from '@/features/question-renderer/cells/input-cell';
import { ContactAttrsProvider } from '@/features/question-renderer/contact-attrs-context';
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

  it('명단 값이 빈 prefill 칸은 잠그지 않는다 — 응답자가 직접 적고, 적은 값을 지우지 않는다', () => {
    const cell = {
      id: 'c-prefill-empty',
      type: 'input',
      content: '',
      defaultValueTemplate: '{{사업자등록번호}}',
    } as unknown as TableCell;
    const onUpdateValue = vi.fn();
    // 명단(회사)에는 이 칸이 읽는 키가 없다
    const { container } = render(renderCell(cell, '123-45-67891', onUpdateValue));
    const input = container.querySelector('input');
    expect(input).not.toBeNull();
    expect(input?.disabled).toBe(false);
    expect(input?.hasAttribute('data-prefilled')).toBe(false);
    expect(input?.value).toBe('123-45-67891');
    // 빈 프리필 값으로 응답자의 입력을 덮어쓰지 않는다
    expect(onUpdateValue).not.toHaveBeenCalled();
  });

  it('명단 값이 있는 prefill 칸은 종전대로 잠근다', () => {
    const cell = {
      id: 'c-prefill-locked',
      type: 'input',
      content: '',
      defaultValueTemplate: '{{회사}}',
    } as unknown as TableCell;
    const { container } = render(renderCell(cell, '메가리서치', vi.fn()));
    const input = container.querySelector('input');
    expect(input?.disabled).toBe(true);
    expect(input?.value).toBe('메가리서치');
  });

  it('「응답자가 고칠 수 있게」를 켠 prefill 칸은 잠그지 않고 처음 한 번만 명단 값을 깐다', () => {
    const cell = {
      id: 'c-prefill-editable',
      type: 'input',
      content: '',
      defaultValueTemplate: '{{회사}}',
      prefillEditable: true,
    } as unknown as TableCell;
    const first = vi.fn();
    const { container, rerender } = render(renderCell(cell, undefined, first));
    expect(first).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledWith('메가리서치');

    // 깔린 값은 평범한 응답값이다 — 잠기지 않는다
    const seeded = vi.fn();
    rerender(renderCell(cell, '메가리서치', seeded));
    const input = container.querySelector('input');
    expect(input?.disabled).toBe(false);
    expect(input?.value).toBe('메가리서치');
    expect(seeded).not.toHaveBeenCalled();

    // 응답자가 고친 값·지운 값을 명단 값으로 되돌리지 않는다
    const edited = vi.fn();
    rerender(renderCell(cell, '메가리서치(주)', edited));
    expect(container.querySelector('input')?.value).toBe('메가리서치(주)');
    rerender(renderCell(cell, '', edited));
    expect(container.querySelector('input')?.value).toBe('');
    expect(edited).not.toHaveBeenCalled();
  });

  it('고칠 수 있는 prefill 칸도 명단 값이 없으면 아무것도 깔지 않는다', () => {
    const cell = {
      id: 'c-prefill-editable-empty',
      type: 'input',
      content: '',
      defaultValueTemplate: '{{사업자등록번호}}',
      prefillEditable: true,
    } as unknown as TableCell;
    const onUpdateValue = vi.fn();
    const { container } = render(renderCell(cell, undefined, onUpdateValue));
    expect(onUpdateValue).not.toHaveBeenCalled();
    expect(container.querySelector('input')?.disabled).toBe(false);
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
