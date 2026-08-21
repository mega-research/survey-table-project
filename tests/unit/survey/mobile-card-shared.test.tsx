import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { MobileDisplayCells } from '@/components/question-renderer/mobile-display-cells';
import { MobileOptionCard } from '@/components/question-renderer/mobile-card-shared';
import type { TableCell } from '@/types/survey';

function cell(partial: Partial<TableCell>): TableCell {
  return {
    id: Math.random().toString(36).slice(2),
    content: '',
    type: 'text',
    ...partial,
  } as TableCell;
}

describe('MobileDisplayCells', () => {
  it('inline 셀은 바로 보이고, collapsed 셀은 "자세히" 토글 후 보인다', () => {
    const cells = [
      cell({ id: 'a', type: 'text', mobileDisplay: 'inline', content: '바로보임' }),
      cell({ id: 'b', type: 'text', mobileDisplay: 'collapsed', content: '접힘내용' }),
    ];
    render(<MobileDisplayCells cells={cells} />);
    expect(screen.getByText('바로보임')).toBeInTheDocument();
    expect(screen.queryByText('접힘내용')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: /자세히/ }));
    expect(screen.getByText('접힘내용')).toBeInTheDocument();
  });

  it('표시 셀이 없으면 아무것도 렌더하지 않는다', () => {
    const { container } = render(
      <MobileDisplayCells cells={[cell({ type: 'text', content: 'x' })]} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});

describe('MobileOptionCard', () => {
  it('라벨/컨트롤을 렌더하고 헤더 클릭 시 onToggle 호출', () => {
    const onToggle = vi.fn();
    render(
      <MobileOptionCard
        label="① 컴퓨터 비전"
        cells={[]}
        control={<input type="checkbox" aria-label="선택" />}
        onToggle={onToggle}
      />,
    );
    expect(screen.getByText('① 컴퓨터 비전')).toBeInTheDocument();
    fireEvent.click(screen.getByText('① 컴퓨터 비전'));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('컨트롤 클릭은 onToggle 로 전파되지 않는다', () => {
    const onToggle = vi.fn();
    render(
      <MobileOptionCard
        label="옵션"
        cells={[]}
        control={<input type="checkbox" aria-label="선택" />}
        onToggle={onToggle}
      />,
    );
    fireEvent.click(screen.getByLabelText('선택'));
    expect(onToggle).not.toHaveBeenCalled();
  });
});
