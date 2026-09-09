import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { InputCell } from '@/components/survey-builder/cells/input-cell';
import type { TableCell } from '@/types/survey';

const cell = (overrides: Partial<TableCell> = {}): TableCell =>
  ({ id: 'c1', type: 'input', content: '', ...overrides }) as TableCell;

function renderCell(c: TableCell, value = '', onUpdateValue = vi.fn()) {
  render(
    <InputCell cell={c} cellResponse={value} onUpdateValue={onUpdateValue} questionId="q1" />,
  );
  return onUpdateValue;
}

/**
 * 새 셀 타입을 만들지 않고 input 셀의 옵션으로 둔 것이라, "여러 줄이어도 값 저장은
 * 한 줄 칸과 똑같다" 가 이 기능의 전제다. 그게 깨지면 내보내기 변수·필수 검증이 갈린다.
 */
describe('표 input 셀 — 여러 줄', () => {
  it('미지정이면 한 줄 입력칸이다', () => {
    renderCell(cell());
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('1 이면 여전히 한 줄이다', () => {
    renderCell(cell({ inputRows: 1 }));
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('2 이상이면 그 높이의 여러 줄 입력칸이 된다', () => {
    renderCell(cell({ inputRows: 5 }));
    const box = screen.getByRole('textbox');
    expect(box.tagName).toBe('TEXTAREA');
    expect(box).toHaveAttribute('rows', '5');
  });

  it('값 저장은 한 줄 칸과 같은 창구를 쓴다', async () => {
    const onUpdate = renderCell(cell({ inputRows: 3 }));
    await userEvent.type(screen.getByRole('textbox'), '가');
    expect(onUpdate).toHaveBeenCalledWith('가');
  });

  it('placeholder·글자수 제한이 그대로 붙는다', () => {
    renderCell(cell({ inputRows: 3, placeholder: '자유롭게 적어주세요', inputMaxLength: 200 }));
    const box = screen.getByPlaceholderText('자유롭게 적어주세요');
    expect(box).toHaveAttribute('maxlength', '200');
  });

  /** 전화번호에 줄바꿈이 들어갈 자리가 없고, 서식·정돈 훅이 한 줄 값을 전제로 선다. */
  it('숫자 모드에서는 여러 줄이 되지 않는다', () => {
    renderCell(cell({ inputRows: 5, inputType: 'number' }));
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });

  it('입력 형식이 걸려 있으면 여러 줄이 되지 않는다', () => {
    renderCell(cell({ inputRows: 5, inputType: 'mobile' }));
    expect(screen.getByRole('textbox').tagName).toBe('INPUT');
  });
});
