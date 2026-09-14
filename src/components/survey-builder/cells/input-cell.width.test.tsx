import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';

import { InputCell } from './input-cell';

function cell(overrides: Partial<TableCell> = {}): TableCell {
  return { id: 'c1', type: 'input', content: '', ...overrides } as TableCell;
}

/**
 * 입력칸 너비(inputWidth) — 지정하면 입력칸이 셀을 채우지 않고 그 너비로 고정된다.
 * 년·월처럼 짧은 값을 받는 칸을 넓은 셀 안에서 작게 그리기 위한 것.
 */
describe('표 input 셀 — 입력칸 너비', () => {
  it('미지정이면 입력칸이 셀 폭 전체를 쓴다', () => {
    render(<InputCell cell={cell()} cellResponse="" onUpdateValue={() => {}} questionId="q1" />);
    const input = screen.getByRole('textbox');
    expect(input.style.width).toBe('');
    expect(input.className).toContain('w-full');
  });

  it('지정하면 그 너비로 고정되고, 오른쪽 단위 글자가 입력칸 바로 뒤에 붙는다', () => {
    render(
      <InputCell
        cell={cell({ inputWidth: 60, content: '월', textPosition: 'right' })}
        cellResponse=""
        onUpdateValue={() => {}}
        questionId="q1"
      />,
    );
    const input = screen.getByRole('textbox');
    expect(input.style.width).toBe('60px');
    // 입력칸을 감싼 칸이 남는 폭을 먹지 않아야(flex-1 아님) 단위 글자가 옆에 붙는다
    const slot = screen.getByText('월').previousElementSibling as HTMLElement;
    expect(slot.contains(input)).toBe(true);
    expect(slot.className).not.toContain('flex-1');
  });

  it('셀 가로 정렬이 오른쪽이면 [입력칸+단위] 묶음이 오른쪽에 붙는다', () => {
    render(
      <InputCell
        cell={cell({ inputWidth: 60, content: '월', textPosition: 'right', horizontalAlign: 'right' })}
        cellResponse=""
        onUpdateValue={() => {}}
        questionId="q1"
      />,
    );
    const row = screen.getByText('월').parentElement as HTMLElement;
    expect(row.className).toContain('justify-end');
  });

  it('세로 카드(ignoreInputWidth)에서는 너비 지정을 무시하고 폭 전체를 쓴다', () => {
    render(
      <InputCell
        cell={cell({ inputWidth: 60 })}
        cellResponse=""
        onUpdateValue={() => {}}
        questionId="q1"
        ignoreInputWidth
      />,
    );
    expect(screen.getByRole('textbox').style.width).toBe('');
  });
});
