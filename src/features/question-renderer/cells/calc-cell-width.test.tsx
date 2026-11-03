import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import type { TableCell } from '@/types/survey';

import { CalcCell } from './calc-cell';

function cell(overrides: Partial<TableCell> = {}): TableCell {
  return { id: 'c1', type: 'calc', content: '건', textPosition: 'right', ...overrides } as TableCell;
}

/**
 * 계산 칸 값 너비(inputWidth) — 입력 칸의 「입력칸 너비」와 같은 규칙. 지정하면 값 칸이 셀을 채우지 않고
 * 그 너비로 고정돼 오른쪽 단위 글자가 값 바로 뒤에 붙는다. 같은 열의 입력 칸과 값·단위 자리가 맞는다.
 */
describe('표 calc 셀 — 값 너비', () => {
  it('미지정이면 값 칸이 셀 폭을 채워 단위가 셀 끝에 선다 (기존 동작)', () => {
    render(<CalcCell cell={cell()} questionId="q1" />);
    const slot = screen.getByText('건').previousElementSibling as HTMLElement;
    expect(slot.className).toContain('flex-1');
    expect((slot.firstElementChild as HTMLElement).style.width).toBe('');
  });

  it('지정하면 값 칸이 그 너비로 고정되고 단위가 바로 뒤에 붙는다', () => {
    render(<CalcCell cell={cell({ inputWidth: 120 })} questionId="q1" />);
    const slot = screen.getByText('건').previousElementSibling as HTMLElement;
    expect(slot.className).not.toContain('flex-1');
    expect((slot.firstElementChild as HTMLElement).style.width).toBe('120px');
  });

  it('셀 가로 정렬을 따른다', () => {
    render(<CalcCell cell={cell({ inputWidth: 120, horizontalAlign: 'center' })} questionId="q1" />);
    const row = screen.getByText('건').parentElement as HTMLElement;
    expect(row.className).toContain('justify-center');
  });

  it('세로 카드(ignoreInputWidth)에서는 너비 지정을 무시한다', () => {
    render(<CalcCell cell={cell({ inputWidth: 120 })} questionId="q1" ignoreInputWidth />);
    const slot = screen.getByText('건').previousElementSibling as HTMLElement;
    expect(slot.className).toContain('flex-1');
  });
});
