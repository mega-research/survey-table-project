import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen } from '@testing-library/react';
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
import type { ContactsRow } from '@/server/read-models/contacts';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [{ key: 'web', label: 'web', source: 'system.web', order: 1 }],
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
    responseStatus: null,
    inviteToken: 'tok',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    ...overrides,
  };
}

function renderTable(rows: ContactsRow[]) {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ContactsTable
        rows={rows}
        total={rows.length}
        page={1}
        pageSize={20}
        scheme={scheme}
        sort="resid"
        dir="asc"
        surveyId="00000000-0000-4000-8000-000000000001"
        resultCodeOptions={[]}
      />
    </QueryClientProvider>,
  );
}

describe('ContactsTable web 컬럼 상태 배지', () => {
  it('완료는 % 없이 완료 배지', () => {
    renderTable([
      row({
        responseStatus: 'completed',
        progressPct: 100,
        respondedAt: new Date('2026-08-15T01:20:00Z'),
      }),
    ]);
    expect(screen.getByText('완료')).toBeInTheDocument();
    expect(screen.queryByText(/100%/)).toBeNull();
  });

  it('이탈은 상태 라벨 + 진행률', () => {
    renderTable([row({ responseStatus: 'drop', progressPct: 40 })]);
    expect(screen.getByText('이탈')).toBeInTheDocument();
    expect(screen.getByText(/40%/)).toBeInTheDocument();
  });

  it('진행중은 상태 라벨 + 진행률 — 스텝 상세(?/? 형태)는 붙지 않는다', () => {
    renderTable([row({ responseStatus: 'in_progress', progressPct: 60 })]);
    expect(screen.getByText('진행중')).toBeInTheDocument();
    expect(screen.getByText(/60%/)).toBeInTheDocument();
    expect(screen.queryByText(/\?\//)).toBeNull();
  });

  it('응답 없음은 대시', () => {
    renderTable([row({})]);
    expect(screen.getByText('—')).toBeInTheDocument();
  });
});
