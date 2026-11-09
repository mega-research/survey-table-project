import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';

import { ShareQuotaStatusPanel } from '@/features/operations/quota/share-quota-status-panel';
import type { ShareQuotaCellStatus, ShareQuotaStatus } from '@/lib/quota/quota-status-calc';

const cell = (ids: string[], labels: string[], mine: number, closed: boolean): ShareQuotaCellStatus => ({
  categoryIds: ids,
  labels,
  mine,
  closed,
});

async function renderOpened(status: ShareQuotaStatus) {
  const user = userEvent.setup();
  render(<ShareQuotaStatusPanel status={status} />);
  await user.click(screen.getByRole('button', { name: /쿼터 현황/ }));
  return user;
}

describe('ShareQuotaStatusPanel — 외주 쿼터 현황', () => {
  it('조건 하나면 셀 목록으로, 접수 중인 셀을 먼저 두고 마감 셀은 「마감」으로 보인다', async () => {
    await renderOpened({
      enabled: true,
      dimensions: [
        {
          id: 'd',
          label: '지역',
          categories: [
            { id: 's', label: '서울' },
            { id: 'b', label: '부산' },
          ],
        },
      ],
      cells: [cell(['s'], ['서울'], 3, true), cell(['b'], ['부산'], 0, false)],
    });
    const items = screen.getAllByRole('listitem');
    expect(items.map((li) => li.textContent)).toEqual(['부산내 완료 0접수 중', '서울내 완료 3마감']);
  });

  it('조건 둘이면 매트릭스 칸에 내 완료 수만 있고 목표(n / m)는 어디에도 없다', async () => {
    await renderOpened({
      enabled: true,
      dimensions: [
        { id: 'g', label: '성별', categories: [{ id: 'm', label: '남' }, { id: 'f', label: '여' }] },
        { id: 'a', label: '연령', categories: [{ id: '20', label: '20대' }, { id: '30', label: '30대' }] },
      ],
      cells: [cell(['m', '20'], ['남', '20대'], 2, true), cell(['f', '30'], ['여', '30대'], 5, false)],
    });
    const table = screen.getByRole('table');
    const maleRow = within(table).getByRole('row', { name: /^남/ });
    // 남 · 20대 = 내 완료 2 + 마감, 남 · 30대 = 목표 없음, 행 계 = 2
    expect(within(maleRow).getAllByRole('cell').map((td) => td.textContent)).toEqual(['2마감', '—', '2']);
    expect(table.textContent).not.toMatch(/\//);
    // 계는 내 완료 수 합이다.
    const totalRow = within(table).getByRole('row', { name: /^계/ });
    expect(totalRow.textContent).toContain('7');
  });

  it('쿼터를 집계만 하는 설문이면 「집계만」을 보인다', async () => {
    await renderOpened({
      enabled: false,
      dimensions: [{ id: 'd', label: '지역', categories: [{ id: 's', label: '서울' }] }],
      cells: [cell(['s'], ['서울'], 1, false)],
    });
    expect(screen.getByText('집계만')).toBeTruthy();
  });
});
