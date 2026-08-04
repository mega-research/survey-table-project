import { fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { HeaderGridEditor } from '@/components/survey-builder/header-grid-editor';
import type { HeaderCell } from '@/types/survey';

function grid(): HeaderCell[][] {
  return [
    [
      { id: 'h1', label: '상반기', colspan: 1, rowspan: 1 },
      { id: 'h2', label: '하반기', colspan: 1, rowspan: 1 },
    ],
  ];
}

describe('HeaderGridEditor 셀별 스타일', () => {
  it('셀마다 스타일 버튼이 하나씩 있다', () => {
    render(<HeaderGridEditor headerGrid={grid()} columnCount={2} onChange={vi.fn()} />);

    expect(screen.getAllByRole('button', { name: '헤더 셀 스타일' })).toHaveLength(2);
  });

  it('한 셀에 배경색을 지정하면 그 셀만 바뀌고 이웃 셀은 그대로다', async () => {
    const onChange = vi.fn();
    render(<HeaderGridEditor headerGrid={grid()} columnCount={2} onChange={onChange} />);

    const buttons = screen.getAllByRole('button', { name: '헤더 셀 스타일' });
    const first = buttons[0];
    expect(first).toBeDefined();
    await userEvent.click(first!);

    await userEvent.type(await screen.findByLabelText('HEX 색상'), 'abc');
    await userEvent.tab();

    expect(onChange).toHaveBeenCalledWith([
      [
        { id: 'h1', label: '상반기', colspan: 1, rowspan: 1, backgroundColor: '#AABBCC' },
        { id: 'h2', label: '하반기', colspan: 1, rowspan: 1 },
      ],
    ]);
  });

  it('배경색을 비우면 필드가 제거된다', async () => {
    const onChange = vi.fn();
    const styled: HeaderCell[][] = [
      [{ id: 'h1', label: '상반기', colspan: 1, rowspan: 1, backgroundColor: '#AABBCC' }],
    ];
    render(<HeaderGridEditor headerGrid={styled} columnCount={1} onChange={onChange} />);

    await userEvent.click(screen.getByRole('button', { name: '헤더 셀 스타일' }));
    await userEvent.click(await screen.findByRole('button', { name: '배경색 없음' }));

    expect(onChange).toHaveBeenCalledWith([
      [{ id: 'h1', label: '상반기', colspan: 1, rowspan: 1 }],
    ]);
  });

  // 아래 두 테스트는 짝이다. 뒤쪽이 "셀을 누르면 선택된다"는 양성 대조군이라,
  // 앞쪽의 부정 단언이 stopPropagation 누락을 실제로 잡아낸다.
  it('스타일 버튼 클릭은 셀을 선택하지 않는다', async () => {
    const merged: HeaderCell[][] = [[{ id: 'h1', label: '상반기', colspan: 2, rowspan: 1 }]];
    render(<HeaderGridEditor headerGrid={merged} columnCount={2} onChange={vi.fn()} />);

    await userEvent.click(screen.getByRole('button', { name: '헤더 셀 스타일' }));

    // 병합 셀이 선택됐다면 "분할" 버튼이 나타난다
    expect(screen.queryByRole('button', { name: /분할/ })).not.toBeInTheDocument();
  });

  it('셀 본문을 mousedown 하면 선택되어 분할 버튼이 나타난다', () => {
    const merged: HeaderCell[][] = [[{ id: 'h1', label: '상반기', colspan: 2, rowspan: 1 }]];
    render(<HeaderGridEditor headerGrid={merged} columnCount={2} onChange={vi.fn()} />);

    fireEvent.mouseDown(screen.getByText('상반기'), { detail: 1 });

    expect(screen.getByRole('button', { name: /분할/ })).toBeInTheDocument();
  });
});
