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

const withPii: ContactColumnScheme = {
  version: 1,
  headerRow: 1,
  columns: [
    { key: '기업명', label: '기업명', source: 'attrs.기업명', order: 1 },
    {
      key: '사업자등록번호',
      label: '사업자등록번호',
      source: 'pii.사업자등록번호',
      order: 2,
      piiType: 'biz_number',
    },
  ],
};

describe('ColumnSchemeEditor 응답 화면 노출 토글', () => {
  beforeEach(() => vi.clearAllMocks());

  it('개인정보 열에만 스위치가 있고, 켜는 순간의 경고 문구가 보인다', () => {
    render(<ColumnSchemeEditor surveyId="sv-1" scheme={withPii} />);

    expect(
      screen.getByRole('switch', { name: '사업자등록번호 응답 화면 노출' }),
    ).toBeInTheDocument();
    expect(screen.queryByRole('switch', { name: '기업명 응답 화면 노출' })).not.toBeInTheDocument();
    expect(
      screen.getByText('켜면 초대 링크를 가진 사람에게 이 값이 그대로 보입니다.'),
    ).toBeInTheDocument();
  });

  it('개인정보 열이 없으면 열 자체가 없다', () => {
    render(
      <ColumnSchemeEditor
        surveyId="sv-1"
        scheme={{ ...withPii, columns: withPii.columns.slice(0, 1) }}
      />,
    );
    expect(screen.queryByText('응답 화면 노출')).not.toBeInTheDocument();
  });

  it('켜고 저장하면 respondentVisible: true 로 저장된다', async () => {
    updateMock.mockResolvedValue(undefined as never);
    const user = userEvent.setup();
    render(<ColumnSchemeEditor surveyId="sv-1" scheme={withPii} />);

    await user.click(screen.getByRole('switch', { name: '사업자등록번호 응답 화면 노출' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    const saved = updateMock.mock.calls[0]![0].scheme.columns;
    expect(saved[1]).toMatchObject({ key: '사업자등록번호', respondentVisible: true });
    expect(saved[0]).not.toHaveProperty('respondentVisible');
  });
});
