import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { PageBreakDivider } from '@/components/survey-builder/page-break-divider';

describe('PageBreakDivider', () => {
  it('비활성 상태에서 클릭하면 onToggle을 호출한다', () => {
    const onToggle = vi.fn();
    render(<PageBreakDivider active={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: /페이지 나누기/ }));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it('활성 상태면 페이지 구분 라벨을 보여준다', () => {
    render(<PageBreakDivider active onToggle={() => {}} />);
    expect(screen.getByText('페이지 나눔')).toBeInTheDocument();
  });
});
