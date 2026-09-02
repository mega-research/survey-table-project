import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ColumnSchemeEditor } from '@/components/operations/contacts/column-scheme-editor';
import type { ContactColumnScheme } from '@/db/schema/schema-types';
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
    { key: '리스트ID', label: '리스트ID', source: 'attrs.리스트ID', order: 2 },
    { key: '회사명', label: '회사명', source: 'attrs.회사명', order: 3, showInMail: true },
  ],
};

describe('ColumnSchemeEditor 메일 표시 토글', () => {
  beforeEach(() => vi.clearAllMocks());

  it('attrs 컬럼에만 메일 표시 스위치가 있다', () => {
    render(<ColumnSchemeEditor surveyId="sv-1" scheme={scheme} />);

    expect(screen.getByRole('switch', { name: '리스트ID 메일 표시' })).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: '시스템ID 메일 표시' })).not.toBeInTheDocument();
  });

  it('켜고 저장하면 showInMail: true 로, 끄면 필드 없이 저장된다', async () => {
    updateMock.mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<ColumnSchemeEditor surveyId="sv-1" scheme={scheme} />);

    await user.click(screen.getByRole('switch', { name: '리스트ID 메일 표시' }));
    await user.click(screen.getByRole('switch', { name: '회사명 메일 표시' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    expect(updateMock).toHaveBeenCalledTimes(1);
    const saved = updateMock.mock.calls[0]![0].scheme.columns;
    expect(saved[1]).toMatchObject({ key: '리스트ID', showInMail: true });
    expect(saved[2]).not.toHaveProperty('showInMail');
  });
});
