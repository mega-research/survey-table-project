import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { QuotaStatusPanel } from '@/features/operations/quota/quota-status-panel';
import type { QuotaCellStatus, QuotaStatus } from '@/lib/quota/quota-status-calc';

const cell = (id: string, label: string, current: number, target: number): QuotaCellStatus => ({
  categoryIds: [id],
  labels: [label],
  target,
  current,
  pct: Math.round((current / target) * 100),
  tone: current >= target ? 'done' : 'low',
});

// 조건 1개 — 매트릭스를 그릴 수 없어 부족 셀 순이 유일한 보기다.
function statusOf(cells: QuotaCellStatus[]): QuotaStatus {
  return {
    enabled: true,
    dimensions: [
      {
        id: 'dim-i',
        label: '업종',
        categories: cells.map((c) => ({ id: c.categoryIds[0]!, label: c.labels[0]! })),
      },
    ],
    cells,
    summary: { targetTotal: 0, currentTotal: 0, pct: 0, closedCells: 0, totalCells: 0, unclassified: 0 },
  };
}

async function renderOpened(status: QuotaStatus) {
  const user = userEvent.setup();
  render(<QuotaStatusPanel status={status} />);
  await user.click(screen.getByRole('button', { name: /쿼터 현황/ }));
}

describe('QuotaStatusPanel 부족 셀 순', () => {
  it('목표를 채운 셀도 목록에서 빼지 않고 부족한 셀 뒤에 달성으로 보인다', async () => {
    await renderOpened(
      statusOf([
        cell('a', '반도체', 25, 25),
        cell('b', '미래 모빌리티', 0, 25),
        cell('c', '스마트 가전', 12, 25),
      ]),
    );
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows.map((r) => r.textContent)).toEqual([
      expect.stringContaining('미래 모빌리티'),
      expect.stringContaining('스마트 가전'),
      expect.stringContaining('반도체'),
    ]);
    expect(rows[2]).toHaveTextContent('25 / 25');
    expect(rows[2]).toHaveTextContent('달성');
    expect(rows[2]).not.toHaveTextContent('남음');
  });

  it('모든 셀이 목표를 채워도 셀 목록을 그대로 보인다', async () => {
    await renderOpened(statusOf([cell('a', '반도체', 25, 25), cell('b', '바이오', 27, 25)]));
    expect(screen.queryByText('부족한 셀이 없습니다')).not.toBeInTheDocument();
    const rows = within(screen.getByRole('list')).getAllByRole('listitem');
    expect(rows).toHaveLength(2);
    expect(rows[1]).toHaveTextContent('27 / 25');
  });
});
