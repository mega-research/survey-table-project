import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/surveys/sv/operations/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

import { ContactsTable } from '@/features/operations/contacts/contacts-table';
import { withoutContactOwnerColumn } from '@/lib/operations/contacts-format';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { ContactsRow } from '@/shared/contracts/contacts-io';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: 'contact_owner', label: '컨택원', source: 'system.contact_owner', order: 2 },
  ],
};

function row(resid: number, assignment: ContactsRow['assignment']): ContactsRow {
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
    assignment,
  };
}

function renderTable(s: ContactColumnScheme, rows: ContactsRow[]) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ContactsTable
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={20}
        scheme={s}
        sort="resid"
        dir="asc"
        surveyId="00000000-0000-4000-8000-000000000001"
        resultCodeOptions={[]}
      />
    </QueryClientProvider>,
  );
}

describe('ContactsTable 「컨택원」 열', () => {
  it('배정 이름 칩, 배정 없음은 「—」', () => {
    renderTable(scheme, [row(1, { id: 'a1', name: '10차' }), row(2, null)]);
    const bodyRows = screen.getAllByRole('row').slice(1);
    expect(within(bodyRows[0]!).getByText('10차')).toBeInTheDocument();
    expect(within(bodyRows[1]!).getByText('—')).toBeInTheDocument();
  });

  it('게스트 스킴에는 「컨택원」 열이 없다', () => {
    const guestScheme = withoutContactOwnerColumn(scheme)!;
    renderTable(guestScheme, [row(1, null)]);
    expect(screen.queryByRole('columnheader', { name: /컨택원/ })).toBeNull();
  });
});
