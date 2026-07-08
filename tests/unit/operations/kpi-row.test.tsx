import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KpiRow } from '@/components/operations/kpi-row';
import type { StatusCounts } from '@/lib/operations/aggregate-status';

const counts: StatusCounts = {
  total: 0,
  completed: 0,
  screenedOut: 0,
  quotafulOut: 0,
  bad: 0,
  drop: 0,
  inProgress: 0,
};

describe('KpiRow', () => {
  it('쿼터 미설정이어도 쿼터 카드를 보여주고 값을 -로 표시한다', () => {
    render(<KpiRow counts={counts} quota={null} />);

    const quotaLabel = screen.getByText('쿼터');
    const quotaCard = quotaLabel.parentElement;

    expect(quotaCard).toBeInTheDocument();
    expect(within(quotaCard as HTMLElement).getAllByText('-')).toHaveLength(2);
  });

  it('쿼터 카드를 완료 카드 바로 뒤에 배치한다', () => {
    render(<KpiRow counts={counts} quota={null} />);

    expect(screen.getByText('완료')).toAppearBefore(screen.getByText('쿼터'));
    expect(screen.getByText('쿼터')).toAppearBefore(screen.getByText('자격 미달'));
  });
});
