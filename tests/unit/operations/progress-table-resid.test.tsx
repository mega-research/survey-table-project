import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/report',
  useSearchParams: () => new URLSearchParams(),
}));

import { ProgressTable } from '@/features/operations/report/progress-table';
import type { ProgressTotals } from '@/lib/operations/report-progress';

const totals: ProgressTotals = {
  groupCount: 0,
  listTotal: 0,
  completedTotal: 0,
  excludedTotal: 0,
  excludedScreenedOut: 0,
  excludedNegativeCode: 0,
  excludedUnsubscribed: 0,
};

function renderTable(showResid?: boolean) {
  return render(
    <ProgressTable
      rows={[]}
      totals={totals}
      metaColumns={[]}
      residLabel="시스템ID"
      {...(showResid !== undefined ? { showResid } : {})}
      page={1}
      size={20}
      sort="responseRate"
      dir="desc"
    />,
  );
}

describe('ProgressTable 시스템ID 표시 토글', () => {
  it('기본값은 표시', () => {
    renderTable();
    expect(screen.getByText('시스템ID')).toBeInTheDocument();
  });

  it('showResid=false 면 시스템ID 컬럼을 렌더하지 않는다', () => {
    renderTable(false);
    expect(screen.queryByText('시스템ID')).toBeNull();
  });
});
