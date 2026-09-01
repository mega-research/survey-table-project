import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { ContactsFilterBar } from '@/components/operations/contacts/contacts-filter-bar';
import { client } from '@/shared/lib/rpc';

const pushMock = vi.fn();

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: pushMock }),
  usePathname: () => '/admin/surveys/sv-1/operations/contacts',
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock('@/shared/lib/rpc', () => ({
  client: {
    contacts: {
      idLists: { create: vi.fn() },
    },
  },
}));

const createMock = vi.mocked(client.contacts.idLists.create);
const SURVEY_ID = '00000000-0000-4000-8000-000000000001';

function pushedParams(): URLSearchParams {
  const lastCall = pushMock.mock.calls.at(-1);
  if (!lastCall) throw new Error('router.push 미호출');
  return new URLSearchParams(String(lastCall[0]).split('?')[1] ?? '');
}

function renderBar(initialValue: string) {
  render(
    <ContactsFilterBar
      surveyId={SURVEY_ID}
      initialClauses={[{ op: null, source: 'attrs.ID', value: initialValue }]}
      columnCandidates={[{ source: 'attrs.ID', label: '리스트ID' }]}
      resultCodeOptions={[]}
    />,
  );
}

describe('ContactsFilterBar — 2,000개 초과 목록은 저장 토큰으로 검색', () => {
  beforeEach(() => vi.clearAllMocks());

  it('상한 이하는 그대로 q 에 싣고 RPC 를 부르지 않는다', async () => {
    const user = userEvent.setup();
    renderBar('99 292 235');

    await user.click(screen.getByRole('button', { name: '검색' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(createMock).not.toHaveBeenCalled();
    expect(pushedParams().get('q')).toBe('99 292 235');
  });

  it('상한 초과는 목록을 저장하고 q 에는 list:<id>:<count> 토큰만 싣는다', async () => {
    createMock.mockResolvedValue({ id: '0f3a4b5c-1111-4222-8333-444455556666', count: 2001 });
    const user = userEvent.setup();
    const ids = Array.from({ length: 2001 }, (_, i) => i + 1);
    renderBar(ids.join(' '));

    await user.click(screen.getByRole('button', { name: '검색' }));

    await waitFor(() => expect(pushMock).toHaveBeenCalled());
    expect(createMock).toHaveBeenCalledWith({ surveyId: SURVEY_ID, ids });
    expect(pushedParams().get('col')).toBe('attrs.ID');
    expect(pushedParams().get('q')).toBe('list:0f3a4b5c-1111-4222-8333-444455556666:2001');
  });

  it('숫자 아닌 값이나 앞에 0 이 붙은 번호가 섞이면 검색하지 않는다', async () => {
    const user = userEvent.setup();
    renderBar('0001 0002 15');

    await user.click(screen.getByRole('button', { name: '검색' }));

    await new Promise((r) => setTimeout(r, 50));
    expect(pushMock).not.toHaveBeenCalled();
    expect(createMock).not.toHaveBeenCalled();
  });

  it('저장에 실패하면 검색하지 않는다', async () => {
    createMock.mockRejectedValue(new Error('network'));
    const user = userEvent.setup();
    renderBar(Array.from({ length: 2001 }, (_, i) => i + 1).join(' '));

    await user.click(screen.getByRole('button', { name: '검색' }));

    await waitFor(() => expect(createMock).toHaveBeenCalled());
    expect(pushMock).not.toHaveBeenCalled();
  });
});
