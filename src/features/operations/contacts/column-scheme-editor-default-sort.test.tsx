import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ColumnSchemeEditor } from '@/features/operations/contacts/column-scheme-editor';
import type { ContactColumnScheme } from '@/shared/contracts/contacts';
import { client } from '@/shared/lib/rpc';

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn(), back: vi.fn() }),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    contacts: {
      columns: { update: vi.fn() },
    },
  },
}));

const updateMock = vi.mocked(client.contacts.columns.update);

const scheme: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: 'resid', label: '시스템ID', source: 'system.resid', order: 1 },
    { key: 'ID', label: 'ID', source: 'attrs.ID', order: 2, defaultSort: true },
    { key: 'NO', label: 'NO', source: 'attrs.NO', order: 3 },
    { key: '대표자명', label: '대표자명', source: 'pii.대표자명', order: 4, piiType: 'name' },
    { key: 'web', label: 'web', source: 'system.web', order: 5 },
  ],
};

describe('ColumnSchemeEditor 기본 정렬 스위치', () => {
  beforeEach(() => vi.clearAllMocks());

  it('명단 일반 열에만 스위치가 있고, 저장된 지정이 켜져 보인다', () => {
    render(<ColumnSchemeEditor surveyId="sv-1" scheme={scheme} />);

    expect(screen.getByRole('switch', { name: 'ID 기본 정렬' })).toBeChecked();
    expect(screen.getByRole('switch', { name: 'NO 기본 정렬' })).not.toBeChecked();
    expect(screen.queryByRole('switch', { name: '시스템ID 기본 정렬' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: '대표자명 기본 정렬' })).not.toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: 'web 기본 정렬' })).not.toBeInTheDocument();
  });

  it('다른 열을 켜면 앞의 지정이 풀려 한 열만 저장된다', async () => {
    updateMock.mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<ColumnSchemeEditor surveyId="sv-1" scheme={scheme} />);

    await user.click(screen.getByRole('switch', { name: 'NO 기본 정렬' }));
    expect(screen.getByRole('switch', { name: 'ID 기본 정렬' })).not.toBeChecked();
    await user.click(screen.getByRole('button', { name: '저장' }));

    const saved = updateMock.mock.calls[0]![0].scheme.columns;
    expect(saved[1]).not.toHaveProperty('defaultSort');
    expect(saved[2]).toMatchObject({ key: 'NO', defaultSort: true });
  });

  it('켜진 열을 다시 누르면 지정이 풀리고 필드 없이 저장된다', async () => {
    updateMock.mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<ColumnSchemeEditor surveyId="sv-1" scheme={scheme} />);

    await user.click(screen.getByRole('switch', { name: 'ID 기본 정렬' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    const saved = updateMock.mock.calls[0]![0].scheme.columns;
    expect(saved.some((c) => 'defaultSort' in c)).toBe(false);
  });
});
