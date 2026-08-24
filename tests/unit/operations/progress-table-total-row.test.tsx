import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/report',
  useSearchParams: () => new URLSearchParams(),
}));

import { ProgressTable } from '@/components/operations/report/progress-table';
import type { ProgressRow, ProgressTotals } from '@/lib/operations/report-progress';

/**
 * 전체 행 — 헤더 바로 아래 첫 줄에 항상 있어야 한다. 값은 페이지에 보이는 행들의
 * 합이 아니라 getProgressTotals 가 준 전체 합계다 (분류 기준·페이지와 무관).
 */

const totals: ProgressTotals = {
  groupCount: 5,
  listTotal: 808,
  completedTotal: 103,
  excludedTotal: 12,
  excludedScreenedOut: 4,
  excludedNegativeCode: 7,
  excludedUnsubscribed: 1,
};

const rows: ProgressRow[] = [
  {
    groupLabel: '2025',
    groupValueRaw: '2025',
    groupValues: ['2025'],
    firstResid: 1,
    listCount: 98,
    completedCount: 18,
    excludedCount: 2,
    meta: {},
  } as ProgressRow,
];

function renderTable() {
  return render(
    <ProgressTable
      rows={rows}
      totals={totals}
      metaColumns={[]}
      residLabel="시스템ID"
      groupColumns={[{ key: 'year', label: '연도' }]}
      page={1}
      size={20}
      sort="responseRate"
      dir="desc"
    />,
  );
}

describe('ProgressTable 제외 내역 푸터', () => {
  it('제외 총계와 사유별 내역을 함께 보여준다', () => {
    renderTable();
    // 사유 버킷은 배타적이라 합이 총계와 같아야 한다 (4 + 7 + 1 = 12).
    expect(
      screen.getByText(/제외 12 \(자격 미달 4, 결과코드 부적격 7, 수신거부 1\)/),
    ).toBeInTheDocument();
  });

  it('발생하지 않은 사유는 표기하지 않는다', () => {
    render(
      <ProgressTable
        rows={rows}
        totals={{ ...totals, excludedTotal: 4, excludedScreenedOut: 4, excludedNegativeCode: 0, excludedUnsubscribed: 0 }}
        metaColumns={[]}
        residLabel="시스템ID"
        groupColumns={[{ key: 'year', label: '연도' }]}
        page={1}
        size={20}
        sort="responseRate"
        dir="desc"
      />,
    );
    expect(screen.getByText(/제외 4 \(자격 미달 4\)/)).toBeInTheDocument();
    expect(screen.queryByText(/수신거부/)).toBeNull();
  });
});

describe('ProgressTable 전체 행', () => {
  it('본문 첫 행이 전체 행이고 전체 합계를 표시한다', () => {
    renderTable();
    const bodyRows = screen.getAllByRole('row').slice(1); // thead 제외
    const totalRow = bodyRows[0]!;
    expect(within(totalRow).getByText('전체')).toBeInTheDocument();
    expect(within(totalRow).getByText('808')).toBeInTheDocument();
    expect(within(totalRow).getByText('103')).toBeInTheDocument();
    // 응답률 = 103/808
    expect(within(totalRow).getByText('12.75')).toBeInTheDocument();
  });

  it('전체 행 값은 화면에 보이는 행들의 합이 아니라 전체 합계다', () => {
    renderTable();
    const bodyRows = screen.getAllByRole('row').slice(1);
    // 데이터 행은 98/18 뿐이지만 전체 행은 808/103 을 유지한다.
    expect(within(bodyRows[1]!).getByText('98')).toBeInTheDocument();
    expect(within(bodyRows[0]!).getByText('808')).toBeInTheDocument();
  });
});
