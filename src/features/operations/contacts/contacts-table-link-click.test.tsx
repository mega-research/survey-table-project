import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  usePathname: () => '/admin/surveys/sv-1/operations/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: { contacts: { attrValues: { list: vi.fn() } } },
}));

import { ContactsTable } from '@/features/operations/contacts/contacts-table';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import type { ContactsRow } from '@/shared/contracts/contacts-io';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: 'link_click', label: '링크 클릭', source: 'system.link_click', order: 2 },
  ],
};

function row(overrides: Partial<ContactsRow>): ContactsRow {
  return {
    id: Math.random().toString(36).slice(2),
    resid: 1,
    groupValue: null,
    attrs: {},
    piiMaskHints: {},
    latestResultCode: null,
    latestAttemptNo: null,
    respondedAt: null,
    progressPct: null,
    latestMailStatus: null,
    linkClick: null,
    responseStatus: null,
    inviteToken: 'tok',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    assignment: null,
    ...overrides,
  };
}

function renderTable(rows: ContactsRow[], tableScheme: ContactColumnScheme = scheme) {
  return render(
    <QueryClientProvider client={new QueryClient()}>
      <ContactsTable
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={20}
        scheme={tableScheme}
        sort="resid"
        dir="asc"
        surveyId="00000000-0000-4000-8000-000000000001"
        resultCodeOptions={[]}
      />
    </QueryClientProvider>,
  );
}

/** 「링크 클릭」 열의 칸 글자 — 본문 줄 순서대로. */
function linkClickCells(): string[] {
  const headers = screen.getAllByRole('columnheader');
  const idx = headers.findIndex((h) => h.textContent?.includes('링크 클릭'));
  expect(idx).toBeGreaterThanOrEqual(0);
  const [, ...bodyRows] = screen.getAllByRole('row');
  return bodyRows.map((r) => within(r).getAllByRole('cell')[idx]?.textContent?.trim() ?? '');
}

describe('ContactsTable 「링크 클릭」 열', () => {
  it('눌렀으면 있음, 발송 이력만 있으면 없음, 발송 이력이 없으면 —', () => {
    renderTable([
      row({ resid: 1, linkClick: 'clicked' }),
      row({ resid: 2, linkClick: 'not_clicked' }),
      row({ resid: 3, linkClick: null }),
    ]);

    expect(linkClickCells()).toEqual(['있음', '없음', '—']);
  });

  it('열 머리에 필터가 붙는다', () => {
    renderTable([row({ linkClick: 'clicked' })]);

    expect(screen.getByRole('button', { name: '링크 클릭 필터' })).toBeInTheDocument();
  });

  it('열 설정에서 숨기면 그리지 않는다', () => {
    renderTable([row({ linkClick: 'clicked' })], {
      ...scheme,
      columns: scheme.columns.map((c) =>
        c.source === 'system.link_click' ? { ...c, hidden: true } : c,
      ),
    });

    expect(screen.queryByText('링크 클릭')).toBeNull();
    expect(screen.queryByText('있음')).toBeNull();
  });
});
