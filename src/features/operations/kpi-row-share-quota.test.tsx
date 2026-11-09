import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { KpiRow } from '@/features/operations/kpi-row';
import type { StatusCounts } from '@/lib/operations/aggregate-status-format';

const counts: StatusCounts = {
  total: 0,
  completed: 0,
  fieldworkCompleted: 0,
  screenedOut: 0,
  quotafulOut: 0,
  bad: 0,
  drop: 0,
  inProgress: 0,
};

function quotaCard() {
  return screen.getByText('쿼터').parentElement as HTMLElement;
}

describe('KpiRow 쿼터 칸 — 외주 링크 투영', () => {
  it('내 완료 수와 마감 셀 수만 보이고 목표 대비 비율·목표 수는 없다', () => {
    render(<KpiRow counts={counts} quota={{ mineTotal: 12, closedCells: 1, totalCells: 4 }} />);
    expect(quotaCard().textContent).toBe('쿼터12내 완료 · 4셀 중 1 마감');
    expect(within(quotaCard()).queryByText(/%/)).toBeNull();
  });

  it('연구원 요약은 지금처럼 달성률과 완료/목표를 보인다', () => {
    render(
      <KpiRow
        counts={counts}
        quota={{ targetTotal: 40, currentTotal: 10, pct: 25, closedCells: 1, totalCells: 4, unclassified: 0 }}
      />,
    );
    expect(quotaCard().textContent).toBe('쿼터25%10/40 · 1 마감');
  });
});
