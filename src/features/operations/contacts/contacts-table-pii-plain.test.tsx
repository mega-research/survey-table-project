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
import type { ContactsRow } from '@/shared/contracts/contacts-io';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '대표자', label: '대표자', source: 'pii.대표자', order: 1, piiType: 'representative' },
    { key: '전화번호', label: '전화번호', source: 'pii.전화번호', order: 2, piiType: 'mobile' },
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
    responseStatus: null,
    inviteToken: 'tok',
    createdAt: new Date('2026-08-01T00:00:00Z'),
    assignment: null,
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

const hints: ContactsRow['piiMaskHints'] = {
  대표자: { fieldType: 'representative', maskHint: '장**' },
  전화번호: { fieldType: 'mobile', maskHint: '010-66...' },
};

describe('조사 대상 목록 — 개인정보 열 평문 표시', () => {
  it('평문이 실린 열은 가리지 않은 값을 그리고, 칸 title 도 그 값이다', () => {
    renderTable([
      row({ piiMaskHints: hints, piiPlain: { 대표자: '장길산', 전화번호: '010-6640-1234' } }),
    ]);

    const name = screen.getByText('장길산');
    expect(name.closest('td')).toHaveAttribute('title', '장길산');
    expect(screen.getByText('010-6640-1234')).toBeInTheDocument();
    expect(screen.queryByText('장**')).not.toBeInTheDocument();
    expect(screen.queryByText('010-66...')).not.toBeInTheDocument();
  });

  it('평문이 빠진 열(복호화 실패)만 마스킹 힌트로 그린다', () => {
    renderTable([row({ piiMaskHints: hints, piiPlain: { 대표자: '장길산' } })]);

    expect(screen.getByText('장길산')).toBeInTheDocument();
    expect(screen.getByText('010-66...')).toBeInTheDocument();
  });

  it('평문을 싣지 않은 행은 종전대로 마스킹 힌트를 그린다', () => {
    renderTable([row({ piiMaskHints: hints })]);

    expect(screen.getByText('장**')).toBeInTheDocument();
    expect(screen.getByText('010-66...')).toBeInTheDocument();
  });

  it('평문도 힌트도 없는 칸은 「—」', () => {
    renderTable([row({ piiPlain: {} })]);

    expect(screen.getAllByText('—')).toHaveLength(2);
  });
});
