import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/report',
  useSearchParams: () => new URLSearchParams(),
}));

import { ProgressTable } from '@/features/operations/report/progress-table';
import type { ProgressRow, ProgressTotals } from '@/lib/operations/report-progress-format';

const totals: ProgressTotals = {
  groupCount: 1,
  listTotal: 50,
  completedTotal: 0,
  excludedTotal: 0,
  excludedScreenedOut: 0,
  excludedNegativeCode: 0,
};

const row: ProgressRow = {
  groupLabel: '2026 광주푸드위크 / (미분류) / (배정 없음)',
  groupValueRaw: '2026 광주푸드위크',
  groupValues: ['2026 광주푸드위크', null, null],
  firstResid: 1,
  listCount: 50,
  completedCount: 0,
  excludedCount: 0,
  meta: {},
};

describe('ProgressTable 값 없는 분류 기준 칸', () => {
  it('명단 열 기준은 줄표로, 따로 문구를 준 기준은 그 문구로 그린다', () => {
    render(
      <ProgressTable
        rows={[row]}
        totals={totals}
        metaColumns={[]}
        residLabel="시스템ID"
        groupColumns={[
          { key: 'Q0', label: 'Q0' },
          { key: 'Q0_1', label: 'Q0_1' },
          { key: 'system:contact_owner', label: '컨택원', nullLabel: '(배정 없음)' },
        ]}
        page={1}
        size={20}
        sort="responseRate"
        dir="desc"
      />,
    );
    const cells = within(screen.getByText('2026 광주푸드위크').closest('tr')!).getAllByRole('cell');
    expect(cells[1]).toHaveTextContent('—');
    expect(cells[2]).toHaveTextContent('(배정 없음)');
    expect(screen.queryByText('(미분류)')).toBeNull();
  });
});
