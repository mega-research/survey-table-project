import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/surveys/sv/operations/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContactsTable } from '@/features/operations/contacts/contacts-table';
import type { ContactColumnScheme, ContactResultCode } from '@/shared/contracts/contacts';
import type { ContactsRow } from '@/shared/contracts/contacts-io';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: 'contact_result', label: '컨택결과', source: 'system.contact_result', order: 2 },
    { key: 'contact_owner', label: '컨택원', source: 'system.contact_owner', order: 3 },
  ],
};

const resultCodes: ContactResultCode[] = [
  { code: '1.조사완료', label: '1.조사완료', order: 1, status: 'positive' },
  { code: '4.부재', label: '4.부재', order: 2 },
  { code: '12.조사대상아님', label: '12.조사대상아님', order: 3 },
  { code: '수신거부', label: '수신거부', order: 4, status: 'neutral' },
  { code: '9.휴/폐업', label: '9.휴/폐업', order: 5, rowMark: 'out' },
];

function row(resid: number, overrides: Partial<ContactsRow> = {}): ContactsRow {
  return {
    id: `r${resid}`,
    resid,
    groupValue: null,
    attrs: {},
    piiMaskHints: {},
    latestResultCode: null,
    latestAttemptNo: null,
    respondedAt: null,
    progressPct: null,
    latestMailStatus: null,
    responseStatus: null,
    inviteToken: 'tok',
    createdAt: new Date('2026-10-01T00:00:00Z'),
    assignment: null,
    ...overrides,
  };
}

function renderTable(rows: ContactsRow[]) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <ContactsTable
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={20}
        scheme={scheme}
        sort="resid"
        dir="asc"
        surveyId="00000000-0000-4000-8000-000000000001"
        resultCodeOptions={resultCodes}
      />
    </QueryClientProvider>,
  );
  return screen.getAllByRole('row').slice(1);
}

describe('ContactsTable 행 표시', () => {
  it('온라인 응답완료와 컨택결과 조사완료는 같은 파란 음영', () => {
    const [responded, byCode, plain] = renderTable([
      row(1, { respondedAt: new Date('2026-11-01T00:00:00Z') }),
      row(2, { latestResultCode: '1.조사완료', latestAttemptNo: 2 }),
      row(3, { latestResultCode: '4.부재', latestAttemptNo: 1 }),
    ]);

    expect(responded).toHaveAttribute('data-row-mark', 'done');
    expect(responded).toHaveClass('bg-blue-50');
    expect(byCode).toHaveAttribute('data-row-mark', 'done');
    expect(byCode).toHaveClass('bg-blue-50');
    expect(plain).toHaveAttribute('data-row-mark', 'none');
    expect(plain).not.toHaveClass('bg-blue-50');
    expect(plain).not.toHaveClass('bg-rose-50');
  });

  it('수신거부·조사대상아님·설정에서 붉게 고른 코드는 붉은 음영이고 결과코드 글자도 붉다', () => {
    const rows = renderTable([
      row(1, { latestResultCode: '수신거부', latestAttemptNo: 1 }),
      row(2, { latestResultCode: '12.조사대상아님', latestAttemptNo: 3 }),
      row(3, { latestResultCode: '9.휴/폐업', latestAttemptNo: 1 }),
    ]);

    for (const r of rows) {
      expect(r).toHaveAttribute('data-row-mark', 'out');
      expect(r).toHaveClass('bg-rose-50');
    }
    expect(within(rows[1]!).getByText('[3] 12.조사대상아님')).toHaveClass('text-rose-700');
  });

  it('응답완료인데 조사대상아님이면 붉은 쪽이 이긴다', () => {
    const [both] = renderTable([
      row(1, {
        respondedAt: new Date('2026-11-01T00:00:00Z'),
        latestResultCode: '12.조사대상아님',
        latestAttemptNo: 2,
      }),
    ]);
    expect(both).toHaveAttribute('data-row-mark', 'out');
    expect(both).not.toHaveClass('bg-blue-50');
  });

  it('표시 없는 행의 결과코드 글자는 붉지 않다', () => {
    const [plain] = renderTable([row(1, { latestResultCode: '4.부재', latestAttemptNo: 1 })]);
    expect(within(plain!).getByText('[1] 4.부재')).not.toHaveClass('text-rose-700');
  });

  it('컨택원 칩은 흰 바탕에 테두리 — 파란 행 음영에 묻히지 않는다', () => {
    const [done] = renderTable([
      row(1, {
        respondedAt: new Date('2026-11-01T00:00:00Z'),
        assignment: { id: 'a1', name: '오태형' },
      }),
    ]);
    const chip = within(done!).getByText('오태형');
    expect(chip).toHaveClass('bg-white');
    expect(chip).toHaveClass('border-blue-200');
    expect(chip).not.toHaveClass('bg-blue-50');
  });
});
