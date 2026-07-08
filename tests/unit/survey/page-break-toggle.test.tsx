import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageBreakToggle } from '@/components/survey-builder/page-break-toggle';

describe('PageBreakToggle', () => {
  it('비활성 상태에서 클릭하면 onToggle을 호출한다', () => {
    const onToggle = vi.fn();
    render(<PageBreakToggle active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /새 페이지로 나누기/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('활성 상태면 해제 라벨을 보여준다', () => {
    const onToggle = vi.fn();
    render(<PageBreakToggle active onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /페이지 나누기 해제/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('클릭이 카드 선택으로 전파되지 않는다', () => {
    const onCardClick = vi.fn();
    render(
      <div onClick={onCardClick}>
        <PageBreakToggle active={false} onToggle={() => {}} />
      </div>,
    );
    fireEvent.click(screen.getByRole('button', { name: /새 페이지로 나누기/ }));
    expect(onCardClick).not.toHaveBeenCalled();
  });
});
