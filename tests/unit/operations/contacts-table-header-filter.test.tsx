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

import { ContactsTable } from '@/components/operations/contacts/contacts-table';
import type { ContactColumnScheme } from '@/db/schema/schema-types';

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '번호', source: 'system.resid', order: 1 },
    { key: 'c1', label: '기업유형', source: 'attrs.기업유형', order: 2 },
    { key: 'c2', label: '전화번호', source: 'pii.mobile', order: 3, piiType: 'mobile' },
    { key: 'c3', label: '컨택결과', source: 'system.contact_result', order: 4 },
    { key: 'c4', label: '메일', source: 'system.email_count', order: 5 },
  ],
};

function renderTable() {
  const queryClient = new QueryClient();
  return render(
    <QueryClientProvider client={queryClient}>
      <ContactsTable
        rows={[]}
        total={0}
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

describe('ContactsTable 헤더 필터 트리거', () => {
  it('필터 가능 컬럼(attrs/pii/결과코드)에만 필터 버튼을 렌더한다', () => {
    renderTable();
    expect(screen.getByRole('button', { name: '기업유형 필터' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '전화번호 필터' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '컨택결과 필터' })).toBeInTheDocument();
    // 시스템 placeholder 컬럼과 resid 는 필터 트리거 없음.
    expect(screen.queryByRole('button', { name: '메일 필터' })).toBeNull();
    expect(screen.queryByRole('button', { name: '번호 필터' })).toBeNull();
  });
});
