import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { PreviewCell } from '@/components/survey-builder/cells/preview-cell';
import type { TableCell } from '@/types/survey';

/** 빌더 모달 미리보기(PreviewCell)도 응답 렌더러와 같은 입력칸 너비 규칙을 쓴다 */
describe('PreviewCell input — 입력칸 너비', () => {
  it('inputWidth 를 주면 미리보기 입력칸도 그 너비로 고정되고 단위 글자가 옆에 붙는다', () => {
    const cell = {
      id: 'c1',
      type: 'input',
      content: '월',
      textPosition: 'right',
      inputWidth: 80,
    } as TableCell;
    render(<PreviewCell cell={cell} />);
    const input = screen.getByPlaceholderText('답변을 입력하세요...') as HTMLInputElement;
    expect(input.style.width).toBe('80px');
    const slot = screen.getByText('월').previousElementSibling as HTMLElement;
    expect(slot.className).not.toContain('flex-1');
  });

  it('미지정이면 폭 전체를 쓴다', () => {
    render(<PreviewCell cell={{ id: 'c1', type: 'input', content: '' } as TableCell} />);
    expect((screen.getByPlaceholderText('답변을 입력하세요...') as HTMLInputElement).style.width).toBe('');
  });
});
